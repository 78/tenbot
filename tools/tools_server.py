
import time
import urllib
import trafilatura
import sqlite3
import os
from bs4 import BeautifulSoup
from flask import Flask, request, jsonify
from transformers import AutoTokenizer
from selenium import webdriver

tokenizer_path = os.environ["TOKENIZER_PATH"]
db_path = './db.sqlite3'
user_agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'

# init tokenizer
print("Loading tokenizer", tokenizer_path)
tokenizer = AutoTokenizer.from_pretrained(tokenizer_path)

# init sqlite3 db
conn = sqlite3.connect(db_path, check_same_thread=False)
CREATE_TABLE = '''CREATE TABLE IF NOT EXISTS messages
    (user_id TEXT, chat_id TEXT, ip TEXT, timestamp INTEGER, model TEXT, completed BOOLEAN, role TEXT, content TEXT)'''
conn.execute(CREATE_TABLE)

# create a new Crhome session
chrome_options = webdriver.ChromeOptions()
chrome_options.add_argument('--headless')
chrome_options.add_argument('--disable-gpu')
chrome_options.add_argument('--no-sandbox')
chrome_options.add_argument(f'--user-agent={user_agent}')
print('Starting Chrome...')
driver = webdriver.Chrome(options=chrome_options)
print('Session ID:', driver.session_id)
driver.execute_script("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

# init flask app
app = Flask(__name__)


@app.route('/tokenize', methods=['POST'])
def tokenize():
    # tokenizer query and return token count
    data = request.get_json()
    query = data['query']
    cut = data.get('cut')
    tokens = tokenizer.encode(query, add_special_tokens=False)
    if cut:
        tokens = tokens[:cut]
        data['shortened'] = tokenizer.decode(tokens)
    data['count'] = len(tokens)
    return jsonify(data)


def extract_bing_results(html):
    # use lxml parser
    soup = BeautifulSoup(html, 'lxml')
    # locate results
    results = []
    for result in soup.find_all('li', class_='b_algo'):
        # extract the title
        title = result.find('h2').text
        # extract the URL
        url = result.find('a').get('href')
        # extract the description by class .b_caption
        description = result.find('div', class_='b_caption').text
        results.append({'title': title, 'url': url, 'description': description})
    if len(results) == 0:
        # if no results found, return the whole page
        return soup.text
    return results


@app.route('/search_web', methods=['POST'])
def search_web():
    data = request.get_json()
    query = data['query']
    print('Bing search for:', query)
    start_time = time.time()
    try:
        # use bing search api to get search results
        url = f'https://cn.bing.com/search?q={urllib.parse.quote(query)}'
        driver.get(url)
        results = extract_bing_results(driver.page_source)
        print('Results:', len(results))
    except Exception as e:
        print(e)
        results = str(e)

    data = {
        'query': query,
        'results': results,
        'response_time': time.time() - start_time
    }
    return jsonify(data)


@app.route('/visit_url', methods=['POST'])
def visit_url():
    data = request.get_json()
    start_time = time.time()

    try:
        driver.get(data['url'])
        result = trafilatura.extract(driver.page_source)
        if not result:
            result = 'No text content found.'
        print('Extracted:', len(result))
    except Exception as e:
        result = str(e)

    return jsonify({
        'content': result,
        'response_time': time.time() - start_time
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
