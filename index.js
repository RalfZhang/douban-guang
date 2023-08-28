/**
 * 大笨钟
 * @authors RalfZ (ralfz.zhang@gmail.com)
 * @date    2017-05-01 17:39:51
 * @version 1.0.0
 */
const rp = require('request-promise');
const ns = require('node-schedule');
const mt = require('moment-timezone');

const config = require('./config.js');

const postMessage = (str) => {
  const dataStringGen = (str) => {
    return config.dataString.replace(/(.*comment=)(.*)(&.*)/, (_, p1, p2, p3) => {
      return `${p1}${str}${p3}`
    });
  };

  const options = {
    url: 'https://www.douban.com/',
    method: 'POST',
    headers: config.headers,
    gzip: true,
    body: dataStringGen(str),
  };

  return rp(options);
}

function postBroadcast(text) {
  console.log('-->', new Date(), 'run postBroadcast.')
  postMessage(text).then(_ => {
    console.log('---->', new Date(), 'postBroadcast Success.')
  }).catch(err => {
    console.log('----> catch event.');
  })
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
  postBroadcast('尝试重启中，故障率应该很高，别抱太大希望……');
  let i = 0;
  ns.scheduleJob('0 * * * *', () => {
    i++;
    console.log('>', new Date(), 'posting hour', i);
    console.log('> Text: ', getText())
    postBroadcast(getText())
  })

  // screen detach 无任务 1 小时候后不执行 schedule，添加每十分钟唤醒
  ns.scheduleJob('30 */10 * * * *', () => {
    i++;
    console.log(new Date(), 'posting min', i);
  })
}

run();
