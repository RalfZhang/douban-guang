/**
 * 大笨钟
 * @authors RalfZ (ralfz.zhang@gmail.com)
 * @date    2017-05-01 17:39:51
 * @version 1.0.0
 */
const rp = require('request-promise');
const ns = require('node-schedule');
const mt = require('moment-timezone');
const URL = require('url').URL;
const crypto = require('crypto');

const config = require('./config.js');

let token = null;

const FrodoRequest = rp.defaults(p => {
  const params = {
    headers: {},
    ...p,
    encoding: 'utf8',
  };
  params.headers['User-Agent'] = config.ua;

  const path = new URL(params.url).pathname;
  if (path !== '/service/auth2/token') {
    params.headers.Authorization = `Bearer ${token}`;
  }

  let signature = params.method;
  signature += `&${encodeURIComponent(decodeURIComponent(path).replace(/\/$/, ''))}`;
  if (params.headers.Authorization) {
    signature += `&${params.headers.Authorization.substring(7)}`;
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  signature += `&${timestamp}`;
  signature = crypto.createHmac('sha1', config.api.secret).update(signature).digest('base64');
  switch (params.method) {
    case "PATCH":
    case "POST":
    case "PROPPATCH":
    case "PUT":
    case "REPORT":
      if (params.formData) {
        params.formData._sig = signature;
        params.formData._ts = timestamp;
      } else {
        params.form = {
          ...params.form,
          _sig: signature,
          _ts: timestamp,
        };
      }
      break;
    default: {
      const url = new URL(params.url);
      url.searchParams.append('_sig', signature);
      url.searchParams.append('_ts', timestamp);
      params.url = url.href;
    }
  }

  return rp(params);
})

function authenticate(callback) {
  FrodoRequest.post({
    url: 'https://frodo.douban.com/service/auth2/token',
    form: {
      client_id: config.api.key,
      client_secret: config.api.secret,
      redirect_uri: 'frodo://app/oauth/callback/',
      grant_type: 'password',
      username: config.username,
      password: config.password
    },
    json: true,
  }).then((res) => {
    if (!res.access_token) {
      console.error('token error. ', res);
      return;
    }
    token = res.access_token;
    if (typeof callback === 'function') {
      callback();
    }
  }).catch(err => {
    console.log('Auth Error: ', err.error.code, err);
  })
}



function postBroadcast(text) {
  let i = 0;
  let tryPost = function () {
    FrodoRequest.post({
      url: 'https://frodo.douban.com/api/v2/status/create_status',
      form: {
        text: text,
      },
      json: true,
      timeout: 10000,
    }).then(res => {
      console.log('----> \n', new Date(), 'postBroadcast Success')
    }).catch(err => {
      if (err && err.error) {
        console.log('----> \n', new Date(), 'postBroadcast ERR. Code: ', err.error.code);
        console.log('Err msg: ', JSON.stringify(err));
        switch (err.error.code) {
          case 103: // INVALID_ACCESS_TOKEN
          case 106: // ACCESS_TOKEN_HAS_EXPIRED
          case 119: // INVALID_REFRESH_TOKEN
          case 123: // ACCESS_TOKEN_HAS_EXPIRED_SINCE_PASSWORD_CHANGED
            console.log('re posting...');
            authenticate(() => postBroadcast(text));
            break;
          case 'ETIMEDOUT':
            if (i < 5) {
              i++;
              tryPost();
            } else {
              console.log(new Date(), 'ERR, posting try more than 5 times');
            }
            break;
        }
      } else {
        console.log('----> \n', new Date(), 'postBroadcast ERR: ', err);
        console.log('Err msg: ', JSON.stringify(err));
      }
    })
  }
  tryPost();
}


function getText() {
  const now = mt().tz('Asia/Shanghai')
  const yearStart = mt(now).startOf('year');
  const yearEnd = mt(yearStart).add(1, 'year');
  let progress = Math.round(100000 * now.diff(yearStart) / yearEnd.diff(yearStart)) / 1000;
  // console.log('p', process)
  let hour = +now.format('HH')
  if (hour === 0) {
    hour = 24
  }
  let year = now.format('YYYY');
  if (progress === 0) { // 处理新年结束
    year = year - 1;
    progress = 100;
  }
  let text = '咣！'.repeat(hour) + `豆瓣大笨钟提醒您：北京时间${hour}点整，${year}年已悄悄溜走${progress}%。`
  return text;
}

function run() {
  authenticate(() => {
    postBroadcast('尝试重启中……')
  });
  let i = 0;
  ns.scheduleJob('0 * * * *', () => {
    i++;
    console.log(new Date(), 'posting hour', i);
    console.log('text', getText())
    postBroadcast(getText())
  })

  // screen detach 无任务 1 小时候后不执行 schedule，添加每十分钟唤醒
  ns.scheduleJob('30 */10 * * * *', () => {
    i++;
    console.log(new Date(), 'posting min', i);
  })
}

run();