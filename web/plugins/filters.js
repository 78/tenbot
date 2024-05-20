import Vue from 'vue'
import moment from 'moment'
moment.locale('zh-CN')

function timeformat (t) {
  if (t) {
    return moment(t).format('YYYY-MM-DD HH:mm:ss')
  }
  return ''
}

function timespan (t) {
  if (t) {
    return moment.utc(t).fromNow(true)
  }
  return ''
}

function fromnow (t) {
  if (t) {
    return moment.utc(t).fromNow()
  }
  return ''
}

Vue.filter('timeformat', timeformat)
Vue.filter('timespan', timespan)
Vue.filter('fromnow', fromnow)

