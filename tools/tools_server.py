
import time
import urllib
import trafilatura
import sqlite3
import os
from flask import Flask, request, jsonify
from sentence_transformers import CrossEncoder
from transformers import AutoTokenizer

tavily_api_key = os.environ["TAVILY_API_KEY"]
reranker_model_path = os.environ["RERANKER_MODEL_PATH"]
tokenizer_path = os.environ["TOKENIZER_PATH"]
db_path = './db.sqlite3'

# Tavily API
from tavily import TavilyClient
tavily = TavilyClient(api_key=tavily_api_key)

# init tokenizer
print("Loading tokenizer", tokenizer_path)
tokenizer = AutoTokenizer.from_pretrained(tokenizer_path)

# init reranker model
print("Loading reranker model", reranker_model_path)
model = CrossEncoder(reranker_model_path, max_length=512)
print("Reranker model loaded.")

# init sqlite3 db
conn = sqlite3.connect(db_path, check_same_thread=False)
CREATE_TABLE = '''CREATE TABLE IF NOT EXISTS messages
    (user_id TEXT, chat_id TEXT, ip TEXT, timestamp INTEGER, model TEXT, completed BOOLEAN, role TEXT, content TEXT)'''
conn.execute(CREATE_TABLE)

# init flask app
app = Flask(__name__)

@app.route('/tokenize', methods=['POST'])
def tokenize():
    # tokenizer query and return token count
    data = request.get_json()
    tokens = tokenizer.tokenize(data['query'])
    data['count'] = len(tokens)
    return jsonify(data)


@app.route('/search_web', methods=['POST'])
def search_web():
    data = request.get_json()
    query = data['query']
    if len(query) < 5:
        query += "的有关内容"

    start_time = time.time()
    print('Searching for:', query)
    try:
        response = tavily.search(query=query, search_depth="advanced", max_results=10)
        results = response['results']

        # tokenizer content in results
        for r in results:
            ids = tokenizer.encode(r['content'], add_special_tokens=False)
            if len(ids) > 200:
                ids = ids[:200]
                r['content'] = tokenizer.decode(ids) + '...'

        # construct sentence pairs
        sentence_pairs = [[query, r['content']] for r in results]

        # calculate scores of sentence pairs
        scores = model.predict(sentence_pairs).tolist()

        # set score to results
        for i, r in enumerate(results):
            r['score'] = scores[i]
            del r['raw_content']
    except Exception as e:
        print(e)
        results = []
    
    # sort by scores descending
    data = {
        'query': query,
        'results': sorted(results, key=lambda x: x['score'], reverse=True)[:3],
        'response_time': time.time() - start_time
    }
    return jsonify(data)


@app.route('/visit_url', methods=['POST'])
def visit_url():
    data = request.get_json()

    try:
        url = urllib.parse.quote(data['url'], safe=':/')
        r = urllib.request.Request(url)
        # set or unset user agent to avoid 403 error
        r.headers.pop('User-Agent', None)
        # r.add_header("User-Agent", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")
        response = urllib.request.urlopen(r)
        data = response.read()

        # Parse the article
        result = trafilatura.extract(data)
        if not result:
            result = 'No text content found.'
        print('Visited:', url, 'Extracted:', len(result))
    except Exception as e:
        result = str(e)

    return jsonify({
        'content': result
    })


@app.route('/log', methods=['POST'])
def log():
    ip = request.headers.get('x-forwarded-for', '').split(',')[0]
    data = request.get_json()
    if 'user_id' not in data or 'chat_id' not in data or 'messages' not in data:
        return jsonify({'error': 'Missing required fields.'}), 400
    
    if len(data['messages']) != 2:
        return jsonify({'error': 'Invalid messages length.'}), 400
    
    for message in data['messages']:
        conn.execute('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                     (data['user_id'], data['chat_id'], ip, message['timestamp'], message.get('model'),
                      message.get('completed'), message['role'], message['content']))
        print(f'[{data["chat_id"]}@{ip}] {message["timestamp"]} {message["role"]}: {message["content"]}')
    conn.commit()
    return jsonify({'success': True})


if __name__ == '__main__':
    app.run(host='localhost', port=int(os.environ.get('PORT', 3020)))
