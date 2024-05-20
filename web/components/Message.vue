<template>
  <div class="message-box">
    <a-row>
      <a-col :span="1">
        <template v-if="item.role === 'assistant' || item.content.startsWith('✿') ">
          <a-avatar shape="square" :size="40" :src="assistantAvatar"></a-avatar>
        </template>
        <template v-else>
          <a-avatar shape="square" :size="40" :src="userAvatar"></a-avatar>
        </template>
      </a-col>
      <a-col :span="23">
        <div class="message-content" ref="content">
          <div v-html="item.html"></div>
        </div>
      </a-col>
    </a-row>
  </div>
</template>

<script>
import userAvatar from '@/assets/user-avatar.png';
import buddyAvatar from '@/assets/buddy-avatar.png';

import katex from 'katex';

export default {
  name: 'Message',
  props: {
    item: {
      type: Object,
      default: () => ({})
    },
    streaming: {
      type: Boolean,
      default: false
    }
  },

  data() {
    return {
      userAvatar,
      assistantAvatar: buddyAvatar
    };
  },

  mounted() {
    this.parseLatex();
  },

  updated() {
    this.parseLatex();
  },

  methods: {
    parseLatex() {
      const $content = this.$refs.content;

      // for each katex class DOM objects, render latex
      const $katex = $content.getElementsByClassName('katex-render');
      for (let i = 0; i < $katex.length; i++) {
        katex.render($katex[i].textContent, $katex[i], {
          throwOnError: false,
          displayMode: $katex[i].tagName === 'DIV',
        });
      }
    }
  },
}
</script>

<style type="text/css">
div.message-content {
  font-size: 1rem;
  margin: 6px 0 0 2rem;
  color: #444;
}


div.message-content pre > code {
  font-size: 0.8rem;
  border-radius: 4px;
}

div.message-content code {
  margin: 0 0.2em;
}

.message-box {
  width: 100%;
  max-width: 768px;
  margin: 0 auto 0;
  padding: 4px 16px;
}
</style>
