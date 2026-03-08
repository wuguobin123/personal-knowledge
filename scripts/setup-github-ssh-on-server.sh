#!/bin/bash
# 在阿里云等服务器上配置 GitHub SSH 密钥
# 用法：上传此脚本到服务器后执行 bash setup-github-ssh-on-server.sh

set -e
EMAIL="wgblearn@163.com"
KEY_PATH="$HOME/.ssh/id_ed25519"
PUB_PATH="${KEY_PATH}.pub"

echo "=== GitHub SSH 密钥配置 ==="
echo "邮箱: $EMAIL"
echo ""

# 确保 .ssh 目录存在
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"

if [ -f "$KEY_PATH" ]; then
  echo "[提示] 已存在密钥: $KEY_PATH"
  echo "如需重新生成，请先删除: rm $KEY_PATH ${PUB_PATH}"
  echo ""
else
  echo "[1/3] 生成 SSH 密钥 (ed25519)..."
  ssh-keygen -t ed25519 -C "$EMAIL" -f "$KEY_PATH" -N ""
  echo "已生成: $KEY_PATH"
  echo ""
fi

echo "[2/3] 公钥内容（请复制整行，添加到 GitHub → Settings → SSH and GPG keys → New SSH key）："
echo "----------------------------------------"
cat "$PUB_PATH"
echo "----------------------------------------"
echo ""

echo "[3/3] 测试 GitHub 连接..."
if ssh -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1; then
  echo ""
  echo "配置完成，可在仓库目录执行: git pull"
else
  echo ""
  echo "若上面提示 Permission denied，请先将上面公钥添加到 GitHub 后再执行："
  echo "  ssh -T git@github.com"
fi
