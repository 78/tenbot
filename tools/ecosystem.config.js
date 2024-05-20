module.exports = {
  apps : [{
    name   : "tools",
    script : "./tools_server.py",
    interpreter: "/root/miniconda3/envs/master/bin/python",
    time   : true,
    env    : {
      "NODE_ENV": "production",
      "PORT": 3020,
      "TAVILY_API_KEY": "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",
      "RERANKER_MODEL_PATH": "/data/models/maidalun/bce-reranker-base_v1",
      "TOKENIZER_PATH": "/data/models/qwen1_5_tokenizer",
    }
  }]
}