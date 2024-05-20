const DeploymentConfig = {
  Node: {
    model: {
      id: 'qwen-110b',
      archecture: 'qwen',
      version: '1.0',
    },
    gpu: {
      model: '3090',
      vram: 24,
      count: 4,
    },
    memory: 64,
    masterServerUrl: 'https://api.yourdomain.com/',
    inferenceServerUrl: 'http://localhost:8000',
    botServerIp: '127.0.0.1',
    botServerPort: 3004,
    pingInterval: 3000
  },

  Master: {
    apiKeys: [
      'test-xxx',
    ],
    port: 3010,
    defaultModel: 'qwen-110b'
  }
};

module.exports = DeploymentConfig;
