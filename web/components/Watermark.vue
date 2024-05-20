<template>
  <div ref="watermark" class="watermark" />
</template>

<script type="text/javascript">
export default {
  props: {
    text: {
      type: String,
      default: ''
    }
  },

  watch: {
    text (newVal, oldVal) {
      this.makeImage(newVal)
    }
  },

  mounted () {
    this.makeImage(this.text)
  },

  methods: {
    makeImage (text) {
      const canvas = document.createElement('canvas')
      canvas.width = 200
      canvas.height = 300
      const ctx = canvas.getContext('2d')
      ctx.font = '15px Arial,sans-serif'
      ctx.fillStyle = '#111'
      ctx.rotate(Math.PI * -20 / 180)
      ctx.fillText(text, 0, 150)
      ctx.fillText(text, 0, 300)
      const base64Url = canvas.toDataURL()
      this.$refs.watermark.style = `background-image: url('${base64Url}')`
    }
  }
}
</script>

<style type="text/css">
.watermark {
  pointer-events: none;
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  right: 0;
  overflow: hidden;
  z-index: 9999;
  background-repeat: repeat, repeat;
  opacity: 0.1;
}
</style>
