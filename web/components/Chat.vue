<template>
  <div class="chatroom" ref="chatroom">
    <a-list
      class="message-list"
      item-layout="horizontal"
      ref="messageList"
    >
      <template #header>
        <div style="text-align: center;">
          <a-space>
            <span>
              Current model
            </span>
            <a-select
              size="small"
              :style="{ width: '160px' }"
              v-model="model"
            >
              <a-select-option
                v-for="m in models"
                :key="m.id"
                :value="m.id"
              >
                {{ m.id }}
              </a-select-option>
            </a-select>
          </a-space>
        </div>
      </template>
      <a-list-item v-for="item in messages" :key="item.timestamp" :class="'message-item-' + item.role">
        <Message :item="item" v-if="item.role !== 'system'" />
      </a-list-item>
      <a-list-item v-if="streamingMessage" class="message-item-assistant">
        <Message :item="streamingMessage" :streaming="true" />
      </a-list-item>
    </a-list>
    <div class="message-input">
      <div style="display: flex; align-items: center;">
        <!-- clear history button -->
        <a-button
          shape="circle"
          icon="delete"
          size="small"
          @click="resetMessages">
        </a-button>
        <a-textarea v-model="input" ref="input"
          :disabled="models.length === 0"
          :auto-size="{ minRows: 1, maxRows: 10 }"
          placeholder="输入消息，按回车发送"
          enterkeyhint="send"
          @pressEnter="sendMessage"
        />
        <!-- send message button -->
        <template v-if="streamingMessage !== null">
          <a-button
            shape="circle"
            icon="pause"
            size="small"
            @click="abortStreaming">
          </a-button>
        </template>
        <template v-else>
          <a-button
            shape="circle"
            icon="right"
            size="small"
            @click="sendMessage">
          </a-button>
        </template>
      </div>
    </div>
    <Watermark v-if="chatId" :text="chatId" />
  </div>
</template>

<script>
import markdownit from 'markdown-it';
import hljs from 'highlight.js';
import { message } from 'ant-design-vue';

const Tools = [{
  'name': 'search_web',
  'description': 'Search the Internet for the given query and return the top 3 results. The results should include the URL, title, and content.',
  'parameters': {
      "type": "object",
      "properties": {
          "query": {
              "type": "string",
              "description": "The search sentence by extending the give query, at least 5 characters long"
          }
      },
      "requimjred": [
          "query"
      ]
  },
}, {
  'name': 'visit_url',
  'description': 'Visit the given URL and return the text content',
  'parameters': {
      "type": "object",
      "properties": {
          "url": {
              "type": "string",
              "description": "The URL to visit"
          }
      },
      "required": [
          "url"
      ]
  },
}]

const ToolsDescription = Tools.map(tool => {
  return `### ${tool.name}\n\n${tool.name}: ${tool.description}\nParameters: ${JSON.stringify(tool.parameters)}`;
}).join('\n\n');

const FunctionMark = '✿FUNCTION✿';
const ArgsMark = '✿ARGS✿';
const ResultMark = '✿RESULT✿';
const ExitMark = '✿RETURN✿';
const ToolsTemplate = `# Tools

## You have access to the following tools:

${ToolsDescription}

## When you need to call a tool, please insert the following command in your reply, which can be called zero or multiple times according to your needs:

${FunctionMark}: The tool to use, should be one of [${Tools.map(tool => tool.name).join(', ')}]
${ArgsMark}: The input of the tool
${ResultMark}: The result returned by the tool. The image needs to be rendered as ![](url)
${ExitMark}: Reply based on tool result`;

const DefaultSystemPrompt = `You are a helpful, respectful and honest INTP-T AI Assistant named Buddy.`;

const WelcomeMessage = '你好！我是 Buddy，有什么可以帮到你？';


const md = markdownit({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true,
  highlight: function (str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return '<pre><code class="hljs">' +
          hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
          '</code></pre>';
      } catch (__) {}
    }
    return '<pre><code class="hljs">' + md.utils.escapeHtml(str) + '</code></pre>';
  }
});

// render link as target="_blank"
md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  const token = tokens[idx];
  token.attrPush(['target', '_blank']);
  return self.renderToken(tokens, idx, options);
};

export default {
  data() {
    return {
      models: [],
      messages: [],
      controller: null,
      streamingMessage: null,
      input: "",
      model: this.$route.query.model || null,
      chatId: null,
      userId: null
    };
  },

  beforeDestroy() {
    this.resetMessages();
  },

  mounted() {
    this.userId = localStorage.getItem('userId');
    if (!this.userId) {
      this.userId = 'UID' + this.generateNewId(8);
      localStorage.setItem('userId', this.userId);
    }

    this.resetMessages();
    this.fetchModels();
  },

  methods: {
    async searchWeb(query) {
      const body = JSON.stringify({
        query: query
      });
      const response = await fetch(process.env.TOOLS_URL + '/search_web', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: body,
        signal: this.controller.signal
      });

      if (!response.ok) {
        // stop streaming if failed
        this.pushStreamChunk('Failed to search the web.');
        this.stopStreaming();
        return;
      }

      const result = await response.json();
      return result;
    },

    async visitUrl(url) {
      const body = JSON.stringify({
        url: url
      });
      const response = await fetch(process.env.TOOLS_URL + '/visit_url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: body,
        signal: this.controller.signal
      });

      if (!response.ok) {
        // stop streaming if failed
        this.pushStreamChunk('Failed to visit the url.');
        this.stopStreaming();
        return;
      }

      const result = await response.json();
      return result;
    },

    async checkForTools() {
      // get last message
      const lastMessage = this.messages[this.messages.length - 1];
      if (lastMessage.role !== 'assistant') {
        return;
      }
      // find last function mark
      const functionMarkIndex = lastMessage.content.lastIndexOf(FunctionMark);
      if (functionMarkIndex != -1) {
        // if exit mark is not found, then the function is not completed
        if (lastMessage.content.indexOf(ExitMark) === -1) {
          const parts = lastMessage.content.split(FunctionMark);
          // remove function part from the last message
          lastMessage.content = parts[0].trim();
          // if empty, remove the last message
          if (!lastMessage.content) {
            this.messages.pop();
          } else {
            lastMessage.html = this.renderMarkdown(lastMessage.content);
          }

          // build the function parts
          const functionParts = `${FunctionMark}${parts[1]}`.trim().split('\n');
          // make sure the last line startswith ArgsMark, or remove the last line
          while (functionParts.length > 0 && functionParts[functionParts.length - 1].indexOf(ArgsMark) === -1) {
            functionParts.pop();
          }

          // add the function part to the new message
          this.pushMessage('user', functionParts.join('\n') + '\n');
          const newMessage = this.messages[this.messages.length - 1];

          const functionName = functionParts[0].replace(FunctionMark + ':', '').trim();
          const functionArgs = functionParts[1].replace(ArgsMark + ':', '').trim();
          const tool = Tools.find(tool => tool.name === functionName);
          if (tool) {
            console.log('functionName:', functionName, 'args:', functionArgs);
            const args = JSON.parse(functionArgs);
            if (functionName === 'search_web') {
              const result = await this.searchWeb(args.query);
              newMessage.content = `${newMessage.content}\n${ResultMark}: ${JSON.stringify(result)}\n${ExitMark}\n\n`;
              newMessage.html = this.renderMarkdown(newMessage.content);
              this.startStreaming();
            } else if (functionName === 'visit_url') {
              const result = await this.visitUrl(args.url);
              newMessage.content = `${newMessage.content}\n${ResultMark}: ${JSON.stringify(result)}\n${ExitMark}\n\n`;
              newMessage.html = this.renderMarkdown(newMessage.content);
              this.startStreaming();
            }
          }
        }
      }
    },

    generateNewId(idLength) {
      // generate a new chat id constructed by uppercase and lowercase letters
      const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const length = idLength || 8;
      let result = '';
      for (let i = 0; i < length; i++) {
        result += letters.charAt(Math.floor(Math.random() * letters.length));
      }
      return result;
    },

    fetchModels() {
      fetch(process.env.OPENAI_API_URL + '/models').then(res => res.json()).then(res => {
        this.models = res.data;
        if (!this.model && this.models.length > 0) {
          this.model = this.models[0].id;
        }

        // focus the input field on desktop
        if (window.innerWidth > 640) {
          this.$nextTick(() => {
            if (this.$refs.input) {
              this.$refs.input.focus();
            }
          });
        }
      }).catch(err => {
        console.error(err);
      });
    },

    resetMessages() {
      if (this.streamingResponse) {
        this.controller.abort();
      }
      this.controller = new AbortController();
      this.messages = [];
      this.streamingMessage = null;
      this.pushMessage('assistant', WelcomeMessage);
      this.chatId = this.generateNewId(8);
    },

    pushMessage(role, content) {
      this.messages.push({
        role: role,
        content: content,
        html: this.renderMarkdown(content),
        timestamp: Date.now() + Math.random()
      });
    },

    getMessages() {
      let systemMessage = DefaultSystemPrompt;
      if (this.model.toLowerCase().indexOf('qwen') !== -1) {
        systemMessage = `${DefaultSystemPrompt}\n\n${ToolsTemplate}`
      }
      const messages = this.messages.map(m => { return { role: m.role, content: m.content.trim() };});
      messages.unshift({ role: 'system', content: systemMessage });
      return messages;
    },

    sendMessage(e) {
      // prevent sending message when shift key is pressed
      if (e.shiftKey) {
        return;
      }
      e.preventDefault();
  
      // prevent sending message when streaming
      if (this.streamingMessage) {
        message.info('Please wait for the streaming message to finish.');
        return;
      }

      // prevent sending empty message
      if (this.input.trim()) {
        // send message to server
        this.pushMessage('user', this.input);
        this.input = "";
	
        // blur the input field on mobile
        if (window.innerWidth < 640) {
          this.$refs.input.blur();
        }

        // scroll the chatroom to the bottom
        this.$nextTick(() => {
          this.scrollToBottom(true);
        });


        this.startStreaming();
      }
    },

    scrollToBottom(force) {
      // scroll the chatroom to the bottom if the chatroom is not scrolled up
      if (force || this.$refs.chatroom.scrollHeight - this.$refs.chatroom.scrollTop - this.$refs.chatroom.clientHeight < 80) {
        this.$refs.chatroom.scrollTop = this.$refs.chatroom.scrollHeight;
      }
    },

    abortStreaming() {
      if (this.streamingMessage) {
        this.controller.abort();
        this.controller = new AbortController();
      }
    },

    startStreaming() {
      // send message to server
      const body = JSON.stringify({
        model: this.model,
        stream: true,
        messages: this.getMessages(),
        stop: [ResultMark, ResultMark + ':', ResultMark + ':\n']
      });
  
      // add a new streaming message
      this.streamingMessage = {
        role: 'assistant',
        content: '',
        html: '',
        timestamp: Date.now(),
        model: this.model,
        completed: false
      };
      this.pushStreamChunk('');

      fetch(process.env.OPENAI_API_URL + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY,
        },
        body: body,
        signal: this.controller.signal
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error(response.statusText);
        }

        const reader = response.body.getReader();
        const textDecoder = new TextDecoder();
        let buffer = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          const text = textDecoder.decode(value);
          // append data to buffer, split by line, remove empty lines
          buffer.push(text);
          buffer = buffer.join('').split('\n');

          // the last line must be ends with a new line
          while (buffer.length > 1) {
            const line = buffer.shift().trim();
            if (!line) {
              continue;
            }

            // remove data: prefix
            const message = line.replace(/^data: /, '');
            if (message === '[DONE]') {
              if (this.streamingMessage) {
                this.streamingMessage.completed = true;
              }
              this.stopStreaming();
              this.$nextTick(() => {
                this.checkForTools();
              });
              return; // Stream finished
            }

            // try to parse message as JSON
            try {
              const parsed = JSON.parse(message);
              const choice = parsed.choices[0];
              const delta = choice.delta;
              if (delta.content) {
                this.pushStreamChunk(delta.content);
              }
            } catch (error) {
              console.error('Could not JSON parse stream message', message, error);
            }
          }
        }
      }).catch(err => {
        console.error(err);
        this.stopStreaming();
      });
    },

    stopStreaming() {
      if (this.streamingMessage === null) {
        return;
      }
      
      this.streamingMessage.html = this.renderMarkdown(this.streamingMessage.content);
      this.messages.push(this.streamingMessage);
      this.streamingMessage = null;

      // report last two messages to server
      const data = {
        user_id: this.userId,
        chat_id: this.chatId,
        messages: this.messages.slice(-2).map(m => { return { role: m.role, content: m.content, timestamp: m.timestamp, model: m.model, completed: m.completed };})
      };
      fetch(process.env.TOOLS_URL + '/log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      }).catch(err => {
        console.error(err);
        alert('Oops, it seems an error occurred. Please try again later.');
        // refresh the page if failed to report
        window.location.reload();
      });
    },

    pushStreamChunk(content) {
      if (this.streamingMessage === null) {
        return;
      }
      this.streamingMessage.content += content;
      this.streamingMessage.html = this.renderMarkdown(this.streamingMessage.content + '𒊹');

      // scroll the chatroom to the bottom
      this.scrollToBottom();
    },

    renderMarkdown(html) {
      // ignore tool template: between FunctionMark and ExitMark, or starts with FunctionMark to the end
      const reTool = new RegExp(`${FunctionMark}: (.*?)\n${ArgsMark}: (.*?)\n(.*?)(${ExitMark}|$)`, 'gs');
      html = html.replace(reTool, (match, p1, p2, p3, p4) => {
        if (p4 === ExitMark) {
          const args = JSON.parse(p2);
          const result = JSON.parse(p3.replace(ResultMark + ': ', ''));
          if (p1 === 'search_web') {
            return `搜索 ${args.query} 返回 ${result.results.length} 条结果。`;
          } else if (p1 === 'visit_url') {
            return `访问 ${args.url} 返回 ${result.content.length} 字符`;
          }
          return ret;
        } else {
          return `等待 ${p1} ${p2} 返回结果...`;
        }
      });

      // replace $$...$$ and $...$ with <span class="katex">...</span>
      html = html.replace(/\$\$([^$]+)\$\$/g, '<div class="katex-render">$1</div>');
      html = html.replace(/\$([^$\n\{\}]+)\$/g, ' <span class="katex-render">$1</span> ');
      // replace \[...\] and \(...\) and \begin{...}...\end{...} with <div class="katex">...</div>
      html = html.replace(/\\\[ ?(.+?) ?\\\]/g, '<div class="katex-render">$1</div>');
      html = html.replace(/\\\( ?(.+?) ?\\\)/g, ' <span class="katex-render">$1</span> ');
      html = html.replace(/(\\begin\{([^\}]+)\}([^\}]+)\\end\{([^\}]+)\})/g,
        '<div class="katex-render">$1</div>');
      
      return md.render(html);
    }
  },
}
</script>

<style type="text/css" scoped>
.chatroom {
  height: 100%;
  overflow-y: auto;
}

.message-list{
  margin: 0 auto 6rem;
}

.message-input {
  position: fixed;
  bottom: 2rem;
  left: 50%;
  width: 640px;
  margin-left: -320px;
  box-shadow: 0 0 1rem #ccc;
  background-color: #f4f4f4;
}

@media screen and (max-width: 640px) {
  .message-input {
    width: 100%;
    width: 320px;
    margin-left: -160px;
  }
}

.message-input button {
  margin: 0 0.5rem;
}

.message-input textarea {
  font-size: 1rem;
  padding: 0.5rem;
  border-radius: 0;
  border-style: none;
}

.message-item-assistant {
  background-color: #f8f8f8;
}
</style>
