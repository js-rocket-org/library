#!/bin/bash
# This script installs pacman (package manager) in git so you can add other packages under windows MSYS2

install_pacman() {
  # This needs to run in an administrator bash shell to allow the cp command to work
  cd /tmp
  git clone -n --depth=1 --filter=blob:none https://github.com/git-for-windows/git-sdk-64.git
  cd git-sdk-64
  git sparse-checkout set --no-cone etc/pacman.d etc/pacman.conf usr/bin/pacman.exe var/lib/pacman
  git checkout
  cp -rf ./etc ./usr ./var /
  pacman --noconfirm -Syy pacman 2>/dev/null
  cd ..
  rm -rf git-sdk-64
}

if [ "$1" = "install-pacman" ]; then install_pacman ; exit $? ; fi

echo "Unknown command: $1
