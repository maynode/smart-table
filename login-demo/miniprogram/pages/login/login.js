const app = getApp()

Page({
  data: {
    scene: '',
    status: 'loading',
    message: '正在获取微信身份…',
    openid: '',
  },

  onLoad(options) {
    const scene = options.scene ? decodeURIComponent(options.scene) : options.ticket || ''
    this.setData({ scene })
    if (!scene) {
      this.setData({
        status: 'error',
        message: '缺少 scene 参数：请从电脑端页面重新生成小程序码',
      })
      return
    }
    this.login(scene)
  },

  login(scene) {
    const that = this
    this.setData({ status: 'loading', message: '正在获取微信身份…' })
    wx.login({
      success(res) {
        if (!res.code) {
          that.setData({ status: 'error', message: 'wx.login 未返回 code' })
          return
        }
        that.confirm(scene, res.code)
      },
      fail() {
        that.setData({ status: 'error', message: 'wx.login 调用失败' })
      },
    })
  },

  confirm(scene, jsCode) {
    const that = this
    wx.request({
      url: app.globalData.apiBase + '/api/login/mini/confirm',
      method: 'POST',
      header: { 'content-type': 'application/json' },
      data: { scene: scene, jsCode: jsCode },
      success(res) {
        const body = res.data || {}
        if (res.statusCode === 200 && body.ok) {
          that.setData({
            status: 'ok',
            message: '已确认，请回到电脑端继续',
            openid: body.openid || '',
          })
        } else {
          that.setData({
            status: 'error',
            message: body.error || '绑定失败（HTTP ' + res.statusCode + '）',
          })
        }
      },
      fail(err) {
        that.setData({
          status: 'error',
          message: '网络失败：' + (err.errMsg || '检查 config.js 的 apiBase 与域名校验设置'),
        })
      },
    })
  },

  retry() {
    if (this.data.scene) this.login(this.data.scene)
  },
})
