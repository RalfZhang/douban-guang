## 部署 / 更新

服务器上（`/path/to/douban-guang/`）：

```bash
git pull
docker compose up -d --build   # 代码变了
# 或
docker compose restart         # 只改了 config.js
```

## 查看日志

```bash
docker compose logs --tail 20 douban-guang
```
