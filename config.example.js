// 复制为 config.js 后填入真实值（config.js 已在 .gitignore，不会提交）
export default {
  api: {
    key: '',        // 豆瓣 frodo apikey
    secret: '',     // 对应 secret，用于请求签名
    device: {       // 伪装成 Android 客户端的设备信息
      sdkInt: 1,
      product: '',
      manufacturer: '',
      model: '',
      id: ''        // udid，任意稳定的十六进制串即可
    }
  },
  username: '',     // 豆瓣账号（邮箱/手机号）
  password: ''      // 豆瓣密码
};
