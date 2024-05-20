// Socket IO node
// --------------------------------------------------------

const NodeConfig = require(process.argv[2] || './deployment.config').Node;
const axios = require('axios');

let currentStatus = 'offline';
let pendingStatus = false;
let modelId = null;
const runningTasks = {};


function updateNodeStatus(newStatus) {
  if (newStatus === currentStatus) {
    return;
  }
  currentStatus = newStatus;
  socket.emit('status', {status: currentStatus});
  console.log('model', modelId, 'status', currentStatus);
}

function checkNodeStatus() {
  if (pendingStatus) {
    return;
  }

  const taskCount = Object.keys(runningTasks).length;
  if (taskCount > 0) {
    console.log('model', modelId, 'running tasks', taskCount);
  }

  const url = NodeConfig.inferenceServerUrl + '/v1/models';
  // If timeout, it means the inference server is not running
  pendingStatus = true;
  axios.get(url, {timeout: 15 * 1000}).then((response) => {
    modelId = response.data.data[0].id;
    updateNodeStatus('online');
  }).catch((error) => {
    updateNodeStatus('offline');
  }).finally(() => {
    pendingStatus = false;
  });
}

checkNodeStatus();
setInterval(checkNodeStatus, NodeConfig.pingInterval || 3000);


const io = require('socket.io-client');
const socket = io(NodeConfig.masterServerUrl, { path: '/master/socket.io/', query: {} });
const outputInterval = NodeConfig.outputInterval || 50;

function isBreakable(content) {
  if ('.!?;。！？；'.includes(content)) {
    return true;
  }
  return false;
}

function addOutputToTask(key, content) {
  if (!runningTasks[key]) {
    console.error('add output to invalid task', key);
    return;
  }

  const task = runningTasks[key];
  task.outputTokens += 1;
  task.outputBuffer.push(content);

  if (Date.now() - task.lastOutputTimestamp >= outputInterval || isBreakable(content)) {
    socket.emit('message', {key, output: task.outputBuffer.join(''), count: task.outputBuffer.length, done: false});
    task.outputBuffer = [];
    task.lastOutputTimestamp = Date.now();
  }
}

function finishTask(key) {
  if (!runningTasks[key]) {
    console.error('finish invalid task', key);
    return;
  }

  const task = runningTasks[key];
  socket.emit('message', {key, output: task.outputBuffer.join(''), done: true, tokens: task.outputTokens});
  delete runningTasks[key];
}

socket.on('connect', () => {
  console.log('connected to', NodeConfig.masterServerUrl);
  socket.emit('config', {model: NodeConfig.model, gpu: NodeConfig.gpu, memory: NodeConfig.memory});
  socket.emit('status', {status: currentStatus});
});

socket.on('add_task', (task) => {
  if (!task.key || runningTasks[task.key]) {
    console.error('add_task', 'invalid key');
    return;
  }

  const data = {
    "model": modelId,
    "messages": task.messages,
    "max_tokens": task.max_tokens,
    "temperature": task.temperature || 0.3,
    "top_p": task.top_p,
    "stop": task.stop,
    "presence_penalty": task.presence_penalty,
    "frequency_penalty": task.frequency_penalty,
    "stream": true
  };

  const timeout = 1000 * 60 * 2;
  const controller = new AbortController();
  const params = {
    responseType: 'stream',
    timeout,
    signal: controller.signal
  };

  runningTasks[task.key] = {
    controller,
    data,
    outputTokens: 0,
    outputBuffer: [],
    lastOutputTimestamp: Date.now()
  };

  axios.post(NodeConfig.inferenceServerUrl + '/v1/chat/completions', data, params).then((response) => {
    let buffer = [];
    response.data.on('data', (data) => {
      // append data to buffer, split by line, remove empty lines
      buffer.push(data.toString());
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
          continue; // Stream finished
        }

        // try to parse message as JSON
        try {
          const parsed = JSON.parse(message);
          const choice = parsed.choices[0];
          const delta = choice.delta;
          if (delta.content?.length) {
            addOutputToTask(task.key, delta.content);
          }
        } catch (error) {
          console.error('Could not JSON parse stream message', message, error);
        }
      }
    });

    response.data.on('end', () => {
      finishTask(task.key);
    });
  }).catch((error) => {
    console.error('error', error);
    delete runningTasks[task.key];
  });
});

socket.on('remove_task', (task) => {
  if (!task.key || !runningTasks[task.key]) {
    return;
  }
  runningTasks[task.key].controller.abort();
  delete runningTasks[task.key];
});

socket.on('disconnect', () => {
  console.log('disconnected');
});

socket.on('error', (error) => {
  console.error('error', error);
});
