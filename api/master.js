// A socket io server for bot nodes to connect to and receive commands from the master node
// --------------------------------------------------------

const express = require("express");
const cors = require("cors");
const app = express();
const http = require("http").createServer(app);
const io = require("socket.io")(http, { path: '/master/socket.io/' });
const MasterConfig = require('./deployment.config').Master;

const nodes = {};

function removeNodeTasks(node) {
  // remove all tasks
  for (const task of node.tasks) {
    if (task.stream) {
      task.res.end();
    } else {
      task.res.status(500).json({ error: 'Node is offline, please retry later.' });
    }
  }
  node.tasks = [];
}

io.on("connection", (socket) => {
  const ip = (socket.handshake.headers['x-forwarded-for'] || '').split(',')[0];
  const node = nodes[socket.id] = { ip, socket, tasks: [], config: {}, status: 'unknown' };

  socket.on("config", (config) => {
    node['config'] = config;
    console.log(`[${node.ip}]`, 'connected', 'ip', ip, 'config', config);
  });

  socket.on('status', ({ status }) => {
    node.status = status;
    console.log(`[${node.ip}]`, 'status', status);

    if (status === 'offline') {
      removeNodeTasks(node);
    }
  });

  socket.on("message", (data) => {
    const message = typeof data === 'string' ? JSON.parse(data) : data;
    const task = node.tasks.find((item) => item.key === message.key);
    if (!task) {
      socket.emit('remove_task', { key: message.key });
      return;
    }

    // remove spaces from beginning of output
    if (task.outputBuffer.length === 0) {
      message.output = message.output.trimLeft();
    }
    task.outputBuffer.push(message.output);
    // make OpenAI style response
    if (task.stream) {
      const response = { id: message.key, object: 'chat.completion', model: task.model, created: task.created, choices: [
        { index: 0, delta: { role: 'assistant', content: message.output }, finish_reason: message.done ? 'stop': null }
      ]};
      task.res.write(`data: ${JSON.stringify(response)}\n\n`);
      if (message.done) {
        task.res.write('data: [DONE]\n\n');
        task.res.end();
      }
    } else {
      if (message.done) {
        const response = { id: message.key, object: 'chat.completion', model: task.model, created: task.created, choices: [
          { index: 0, message: { role: 'assistant', content: task.outputBuffer.join('') }, finish_reason: 'stop' }
        ]};
        task.res.json(response);
      }
    }
  });

  socket.on("disconnect", () => {
    removeNodeTasks(node);
    delete nodes[socket.id];
    console.log(`[${node.ip}]`, 'disconnected');
  });
});

function findAvailableNode(task) {
  // find node with least tasks
  let minTasks = Infinity;
  let minNode = null;
  for (const [id, node] of Object.entries(nodes)) {
    if (task.model && node.config.model.id !== task.model) {
      continue;
    }
    if (!task.model && node.config.model.id !== MasterConfig.defaultModel) {
      continue;
    }
    if (node.status !== 'online') {
      continue;
    }
    if (node.tasks.length < minTasks) {
      minTasks = node.tasks.length;
      minNode = node;
    }
  }
  
  if (minNode && !task.model) {
    // assign model to task
    task.model = minNode.config.model.id;
  }
  return minNode;
}

// handle POST /chat/completions
app.use(express.json());
app.use(cors());

app.get('/v1/models', (req, res) => {
  const models = [];
  for (const [id, node] of Object.entries(nodes)) {
    const model = node.config.model;
    if (models.find(m => m.id === model.id)) {
      continue;
    }
    model.object = 'model';
    model.owned_by = 'organization-owner';
    models.push(model);
  }
  models.sort((a, b) => a.id == MasterConfig.defaultModel ? -1 : 0)
  res.json({ data: models, object: 'list'});
});

app.get('/v1/nodes', (req, res) => {
  const data = [];
  for (const [id, node] of Object.entries(nodes)) {
    data.push({id, ip: node.ip, config: node.config, tasks: node.tasks.length});
  }
  res.json({ data, object: 'list'});
});

app.post('/v1/chat/completions', (req, res) => {
  // verify bearer apiKey from authorization header
  const apiKey = req.headers.authorization?.toLowerCase().replace('bearer ', '');
  if (MasterConfig.apiKeys.indexOf(apiKey) === -1) {
    res.status(401).json({ error: 'Invalid API key.\n' });
    return;
  }

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0];
  const task = req.body;
  if (!task.messages || task.messages.length === 0) {
    res.status(400).json({ error: '`messages` is required.\n' });
    return;
  }

  task.max_tokens = task.max_tokens || task.max_new_tokens;
  task.input = task.messages[task.messages.length - 1].content.trim();
  task.key = Math.random().toString(36).substring(2);

  // for Will's test
  if (task.model === 'gpt-3.5-turbo') {
    task.model = null;
  }
  // if task.stop is string, convert to array
  if (task.stop && !Array.isArray(task.stop)) {
    task.stop = [task.stop];
  }

  const node = findAvailableNode(task);
  if (!node) {
    res.status(500).json({ error: `No available node for model ${task.model}` });
    return;
  }
  // send task to node
  node.socket.emit('add_task', task);
  console.log(`[${node.ip}]`, '[INPUT]', task.key, task.model, task.input, 'from', ip, 'apiKey', apiKey);

  // add task to nodes
  task.res = res;
  task.outputBuffer = [];
  task.created = parseInt(Date.now()/1000);
  node['tasks'].push(task);

  // remove task from node when socket is closed
  req.socket.on('close', () => {
    node.socket.emit('remove_task', { key: task.key });
    console.log(`[${node.ip}]`, '[OUTPUT]', task.key, 'tokens', task.outputBuffer.length, task.outputBuffer.join(''));
    // remove task from node
    node.tasks = node.tasks.filter(t => t.key !== task.key);
  });

  if (task.stream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
  }
});


// run app
const port = MasterConfig.port || process.env.PORT || 3010;
http.listen(port, () => {
  console.log(`listening on *:${port}`);
});

