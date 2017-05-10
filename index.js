/**
 * 大笨钟
 * @authors RalfZ (ralfz.zhang@gmail.com)
 * @date    2017-05-01 17:39:51
 * @version 1.0.0
 */
const rp = require('request-promise')
const ns = require('node-schedule')
const mt = require('moment-timezone')

const config = require('./config.js')

let token = null;
const userAgent = `api-client/2.0 com.douban.shuo/${config.device}`;

function authenticate(callback) {
  rp.post({
    url: 'https://www.douban.com/service/auth2/token',
    encoding: 'utf8',
    headers: {
      'User-Agent': userAgent
    },
    form: {
      client_id: config.api.key,
      client_secret: config.api.secret,
      redirect_uri: 'http://shuo.douban.com/!service/android',
      grant_type: 'password',
      username: config.username,
      password: config.password
    },
    json: true
  }).then((res) => {
    if (!res.access_token) {
      console.error('token error. ', res)
      return;
    }
    token = res.access_token;
    if (typeof callback === 'function') {
      callback();
    }
  }).catch(err => {
    console.log('Auth Error: ', err.error.code, err)
  })
}



function postBroadcast(text) {
  let i=0;
  let tryPost=function(){
    rp.post({
      url: 'https://api.douban.com/v2/lifestream/statuses',
      encoding: 'utf8',
      headers: {
        'User-Agent': userAgent,
        'Authorization': `Bearer ${token}`
      },
      form: {
        version: 2,
        text: text,
      },
      json: true,
      timeout: 10000,
    }).then(res => {
      console.log('----> \n', new Date(), 'postBroadcast Success')
    }).catch(err => {
      if (err && err.error) {
        console.log('----> \n', new Date(), 'postBroadcast ERR. Code: ', err.error.code)
        console.log('Err msg: ', JSON.stringify(err))
        switch (err.error.code) {
          case 103: // INVALID_ACCESS_TOKEN
          case 106: // ACCESS_TOKEN_HAS_EXPIRED
          case 119: // INVALID_REFRESH_TOKEN
          case 123: // ACCESS_TOKEN_HAS_EXPIRED_SINCE_PASSWORD_CHANGED
            console.log('re posting...')
            authenticate(() => postBroadcast(text));
            break;
          case 'ETIMEDOUT': 
            if(i<5){
              i++;
              tryPost();
            }else{
              console.log(new Date(), 'ERR, posting try more than 5 times')
            }
            break;
        }
      } else {
        console.log('----> \n', new Date(), 'postBroadcast ERR: ', err)
        console.log('Err msg: ', JSON.stringify(err))
      }
    })
  }
  tryPost();
}


function getText() {
  const now = mt().tz('Asia/Shanghai')
  const yearStart = mt(now).startOf('year');
  const yearEnd = mt(yearStart).add(1, 'year');
  const progress = Math.round(100000 * now.diff(yearStart) / yearEnd.diff(yearStart)) / 1000;
  // console.log('p', process)
  let hour = + now.format('HH')
  if (hour === 0) {
    hour = 24
  }
  const year = now.format('YYYY')
  let text = '咣！'.repeat(hour) + `豆瓣大笨钟提醒您：北京时间${hour}点整，${year}年已悄悄溜走${progress}%。`
  return text;
}

function run() {
  authenticate(()=>{
    // postBroadcast('开工啦')
  });
  let i=0;
  ns.scheduleJob('0 * * * *', () => {
    i++;
    console.log(new Date(), 'posting hour', i);
    console.log('text',getText())
    postBroadcast(getText())
  })

  // screen detach 无任务 1 小时候后不执行 schedule，添加每十分钟唤醒
  ns.scheduleJob('30 */10 * * * *', () => {
    i++;
    console.log(new Date(), 'posting min', i);
    // postBroadcast('test '+i)
  })
}

run();