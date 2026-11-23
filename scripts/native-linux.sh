#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p build
c++ -std=c++17 -O2 -Wall -Wextra native/linux/input.cpp -o build/chirp-input -lXi -lXtst -lX11
