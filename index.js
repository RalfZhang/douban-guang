/**
 * 大笨钟
 * @authors RalfZ (ralfz.zhang@gmail.com)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import ns from 'node-schedule';
import mt from 'moment-timezone';

import config from './config.js';

let accessToken = null;

// healthcheck.js 读这个文件的 mtime 判断进程是否还活着
const HEARTBEAT_FILE = process.env.HEARTBEAT_FILE || '/tmp/douban-guang.heartbeat';
function beat() {
  try { fs.writeFileSync(HEARTBEAT_FILE, String(Date.now())); }
  catch (err) { log.warn(`heartbeat write failed: ${err.message}`); }
}

// ---- logger ---------------------------------------------------------------
// LOG_LEVEL: debug < info < warn < error（默认 info）。所有时间统一北京时间。
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function emit(level, msg, extra) {
  if (LEVELS[level] < threshold) return;
  const ts = mt().tz('Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss');
  const line = `${ts} [${level.toUpperCase()}] ${msg}`;
  const sink = level === 'error' || level === 'warn' ? console.error : console.log;
  if (extra !== undefined) sink(line, extra);
  else sink(line);
}

const log = {
  debug: (m, e) => emit('debug', m, e),
  info: (m, e) => emit('info', m, e),
  warn: (m, e) => emit('warn', m, e),
  error: (m, e) => emit('error', m, e),
};

// 把任意错误（HTTP 错误 / undici 网络错误 / 抛出的对象）压成一行可读文本
function describeError(err) {
  if (!err) return 'unknown error';
  const parts = [];
  if (err.statusCode) parts.push(`HTTP ${err.statusCode}`);
  if (err.body !== undefined) {
    if (err.body && typeof err.body === 'object') {
      const { code, msg, localized_message: lm } = err.body;
      parts.push(JSON.stringify({ code, msg: msg || lm }));
    } else {
      parts.push(String(err.body).slice(0, 200));
    }
  }
  // undici 的 "fetch failed" 真正原因都在 err.cause 里（ENOTFOUND/ETIMEDOUT/...）
  if (err.cause) parts.push(`cause=${err.cause.code || err.cause.message || err.cause}`);
  if (!parts.length) parts.push(err.message || String(err));
  return parts.join(' ');
}
// ---------------------------------------------------------------------------

async function frodoRequest({ url, method = 'GET', form }) {
  method = method.toUpperCase();
  const u = new URL(url);
  const path = u.pathname;

  const headers = {
    'User-Agent':
      `api-client/1 com.douban.frodo/7.13.0(223) Android/${config.api.device.sdkInt}` +
      ` product/${config.api.device.product} vendor/${config.api.device.manufacturer}` +
      ` model/${config.api.device.model}  rom/android  network/wifi` +
      `  udid/${config.api.device.id}  platform/mobile`,
  };

  if (path !== '/service/auth2/token' && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const isWrite = ['PATCH', 'POST', 'PUT'].includes(method);
  const body = isWrite ? new URLSearchParams(form || {}) : null;

  const addParam = (name, value) => {
    if (isWrite) body.set(name, value);
    else u.searchParams.set(name, value);
  };

  addParam('udid', config.api.device.id);
  addParam('apikey', config.api.key);
  addParam('os_rom', 'android');
  addParam('channel', 'Douban');

  let signature = method;
  signature += `&${encodeURIComponent(decodeURIComponent(path).replace(/\/$/, ''))}`;
  if (headers.Authorization) {
    signature += `&${headers.Authorization.substring(7)}`;
  }
  const timestamp = Math.floor(Date.now() / 1000).toString();
  signature += `&${timestamp}`;
  const sig = crypto.createHmac('sha1', config.api.secret).update(signature).digest('base64');
  addParam('_sig', sig);
  addParam('_ts', timestamp);

  const init = { method, headers, signal: AbortSignal.timeout(15000) };
  if (isWrite) {
    init.body = body.toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  const started = Date.now();
  log.debug(`${method} ${path}`);
  const res = await fetch(u.toString(), init);
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }

  log.debug(`${method} ${path} -> ${res.status} (${Date.now() - started}ms)`);

  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.statusCode = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

async function authenticate() {
  const body = await frodoRequest({
    url: 'https://frodo.douban.com/service/auth2/token',
    method: 'POST',
    form: {
      client_id: config.api.key,
      client_secret: config.api.secret,
      redirect_uri: 'frodo://app/oauth/callback/',
      disable_account_create: 'false',
      grant_type: 'password',
      username: config.username,
      password: config.password,
    },
  });
  if (!body.access_token) throw body;
  accessToken = body.access_token;
  log.info(`authenticated as ${body.douban_user_name || body.douban_user_id}`);
}

async function sendBroadcast(text, retried = false) {
  const started = Date.now();
  try {
    const body = await frodoRequest({
      url: 'https://frodo.douban.com/api/v2/status/create_status',
      method: 'POST',
      form: { text },
    });
    log.info(`broadcast OK (id=${body && body.id}, ${Date.now() - started}ms)`);
  } catch (err) {
    const code = err.body && err.body.code;
    // 103 invalid token, 106 expired, 119 invalid refresh, 123 expired since password change
    if (!retried && [103, 106, 119, 123].includes(code)) {
      log.warn(`token invalid (code ${code}), re-authenticating`);
      await authenticate();
      return sendBroadcast(text, true);
    }
    log.error(`broadcast failed (${Date.now() - started}ms): ${describeError(err)}`);
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
  log.info(`posting: ${text}`);
  try {
    await sendBroadcast(text);
  } catch {
    // 具体原因已在 sendBroadcast 里 log.error 过，这里只标记本次整点放弃
    log.warn('hourly post given up after failure');
  }
}

// 兜底：进程级异常也要留下日志，方便容器重启后回溯
process.on('unhandledRejection', (reason) => {
  log.error(`unhandledRejection: ${describeError(reason instanceof Error ? reason : { message: String(reason) })}`);
});
process.on('uncaughtException', (err) => {
  log.error(`uncaughtException: ${describeError(err)}`);
  process.exit(1);
});

log.info(`大笨钟 starting (node ${process.version}, log level ${process.env.LOG_LEVEL || 'info'})`);
beat();

await authenticate();
await sendBroadcast('尝试重启中……').catch(() => log.warn('startup broadcast failed (see error above)'));

ns.scheduleJob('0 * * * *', postHourly);

// screen detach 无任务 1 小时后不执行 schedule，添加每十分钟唤醒；顺便刷新心跳
ns.scheduleJob('30 */10 * * * *', () => {
  log.debug('wakeup tick');
  beat();
});
