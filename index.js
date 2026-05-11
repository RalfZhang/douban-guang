/**
 * 大笨钟
 * @authors RalfZ (ralfz.zhang@gmail.com)
 */
'use strict';

const crypto = require('crypto');
const rp = require('request-promise');
const ns = require('node-schedule');
const mt = require('moment-timezone');

const config = require('./config.js');

let accessToken = null;

const FrodoRequest = rp.defaults(params => {
  params.encoding = 'utf8';
  if (!params.headers) params.headers = {};

  const path = new URL(params.url).pathname;
  if (path !== '/service/auth2/token' && accessToken) {
    params.headers.Authorization = `Bearer ${accessToken}`;
  }

  const addParam = (name, value) => {
    const m = (params.method || 'GET').toUpperCase();
    if (['PATCH', 'POST', 'PUT'].includes(m)) {
      if (params.formData) {
        params.formData[name] = value;
      } else {
        if (!params.form) params.form = {};
        params.form[name] = value;
      }
    } else {
      if (!params.qs) params.qs = {};
      params.qs[name] = value;
    }
  };

  params.headers['User-Agent'] =
    `api-client/1 com.douban.frodo/7.13.0(223) Android/${config.api.device.sdkInt}` +
    ` product/${config.api.device.product} vendor/${config.api.device.manufacturer}` +
    ` model/${config.api.device.model}  rom/android  network/wifi` +
    `  udid/${config.api.device.id}  platform/mobile`;

  addParam('udid', config.api.device.id);
  addParam('apikey', config.api.key);
  addParam('os_rom', 'android');
  addParam('channel', 'Douban');

  let signature = (params.method || 'GET').toUpperCase();
  signature += `&${encodeURIComponent(decodeURIComponent(path).replace(/\/$/, ''))}`;
  if (params.headers.Authorization) {
    signature += `&${params.headers.Authorization.substring(7)}`;
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  signature += `&${timestamp}`;
  const sig = crypto.createHmac('sha1', config.api.secret).update(signature).digest('base64');
  addParam('_sig', sig);
  addParam('_ts', timestamp);

  return rp(params);
});

async function authenticate() {
  const body = await FrodoRequest.post({
    url: 'https://frodo.douban.com/service/auth2/token',
    form: {
      client_id: config.api.key,
      client_secret: config.api.secret,
      redirect_uri: 'frodo://app/oauth/callback/',
      disable_account_create: 'false',
      grant_type: 'password',
      username: config.username,
      password: config.password
    },
    json: true
  });
  if (!body.access_token) throw body;
  accessToken = body.access_token;
  console.log('-->', new Date(), 'authenticated as', body.douban_user_name || body.douban_user_id);
}

async function sendBroadcast(text) {
  try {
    const body = await FrodoRequest.post({
      url: 'https://frodo.douban.com/api/v2/status/create_status',
      form: { text },
      json: true
    });
    console.log('---->', new Date(), 'broadcast OK, id', body && body.id);
  } catch (err) {
    const code = err && err.response && err.response.body && err.response.body.code;
    // 103 invalid token, 106 expired, 119 invalid refresh, 123 expired since password change
    if ([103, 106, 119, 123].includes(code)) {
      console.log('---->', new Date(), 'token invalid (code', code + '), re-authenticating');
      await authenticate();
      return sendBroadcast(text);
    }
    console.log('----> broadcast failed:', (err && err.response && err.response.body) || err.message);
    throw err;
  }
}

function getText() {
  const now = mt().tz('Asia/Shanghai');
  const yearStart = mt(now).startOf('year');
  const yearEnd = mt(yearStart).add(1, 'year');
  let progress = Math.round(100000 * now.diff(yearStart) / yearEnd.diff(yearStart)) / 1000;
  let hour = +now.format('HH');
  if (hour === 0) hour = 24;
  let year = now.format('YYYY');
  if (progress === 0) {
    year = year - 1;
    progress = 100;
  }
  return '咣！'.repeat(hour) + `豆瓣大笨钟提醒您：北京时间${hour}点整，${year}年已悄悄溜走${progress}%。`;
}

async function postHourly() {
  const text = getText();
  console.log('>', new Date(), 'posting:', text);
  try {
    await sendBroadcast(text);
  } catch (e) {
    console.log('----> catch event.');
  }
}

async function run() {
  await authenticate();
  await sendBroadcast('尝试重启中……').catch(() => console.log('----> startup broadcast failed'));

  ns.scheduleJob('0 * * * *', postHourly);

  // screen detach 无任务 1 小时后不执行 schedule，添加每十分钟唤醒
  ns.scheduleJob('30 */10 * * * *', () => {
    console.log(new Date(), 'wakeup tick');
  });
}

run();
