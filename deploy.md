# 部署 / 运维

服务器上目录 `/path/to/douban-guang/`，需要 Docker + Docker Compose。

## 首次部署

```bash
git clone <repo> && cd douban-guang
cp config.example.js config.js   # 填入账号与 apikey/secret
docker compose up -d --build
```

`config.js` 只读挂载进容器，不进镜像也不进 git。

## 更新

```bash
git pull
docker compose up -d --build   # 代码变了，重新构建
# 或
docker compose restart         # 只改了 config.js，无需重建
```

## 查看日志

日志统一为「北京时间 + 级别」格式，错误走 stderr：

```bash
docker compose logs --tail 50 -f douban-guang   # 实时
docker compose logs douban-guang 2>&1 | grep ERROR   # 只看错误
```

日志已配置滚动（单文件 10MB、保留 3 个），不会写满磁盘。

## 健康状态

容器内置 healthcheck：进程每 10 分钟刷新一次心跳，超过 15 分钟没更新即判定 unhealthy，配合 `restart: unless-stopped` 自动拉起。

```bash
docker compose ps            # 看 STATUS 是否 (healthy)
docker inspect --format '{{json .State.Health}}' douban-guang
```

## 详细排查（开 debug）

`compose.yaml` 里把 `LOG_LEVEL` 改成 `debug`，能看到每个请求的 `method path -> status (耗时ms)`：

```yaml
    environment:
      - LOG_LEVEL=debug
```

```bash
docker compose up -d   # 改 env 无需 --build
```

排查完记得改回 `info`。

## 常见故障

### `broadcast failed: ... cause=XXX`

这是网络层失败（不是 token 问题，token 失效会自动重登重发）。看 `cause=` 后面：

| cause | 含义 | 处理 |
| --- | --- | --- |
| `ENOTFOUND` | DNS 解析不了 frodo.douban.com | 给容器配 DNS（见下） |
| `ETIMEDOUT` / `ECONNRESET` / `UND_ERR_CONNECT_TIMEOUT` | 连得上但被掐断/超时，常见于海外服务器被豆瓣限制 | 配代理 |
| `CERT_*` / TLS 相关 | 证书/握手问题 | 检查系统时间、CA |

容器内直接测连通性：

```bash
docker compose exec douban-guang sh -c "wget -S -O- --timeout=15 https://frodo.douban.com/ 2>&1 | head"
docker compose exec douban-guang sh -c "nslookup frodo.douban.com; cat /etc/resolv.conf"
```

**配 DNS**（`compose.yaml` 的 service 下）：

```yaml
    dns:
      - 223.5.5.5
      - 8.8.8.8
```

**配代理**（让容器内 fetch 走 HTTP 代理，Node 18+ 原生支持）：

```yaml
    environment:
      - LOG_LEVEL=info
      - HTTP_PROXY=http://proxy-host:port
      - HTTPS_PROXY=http://proxy-host:port
```

### 登录失败 / `HTTP 4xx {"code":...}`

apikey/secret 或账号密码不对，检查 `config.js`。改完 `docker compose restart`。

### 时间不对

业务时间强制 `Asia/Shanghai`，与服务器时区无关；日志时间也是北京时间。若日志时间异常，检查镜像内 tzdata（Dockerfile 已安装）。
