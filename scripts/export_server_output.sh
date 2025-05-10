#!/bin/bash

cd "$(dirname "$0")/.." || exit 1

# Define pruned paths
excluded_paths=(
  "./app/api/utils"
  "./app/lib"
  "./app/nft"
  "./app/old"
  "./app/about"
  "./app/auctions"
  "./app/api/holders/[contract]"
  "./app/api/holders/blockchain"
)

# Build excluded_files list
excluded_files=$(find "${excluded_paths[@]}" -type f -name "ClientProvider.js" 2>/dev/null | sort)
  #-path "./app/api/utils" -prune -o \

# Build included_files list
included_files=$(find ./app  ./app/lib \
  -path "./app/nft" -prune -o \
  -path "./app/old" -prune -o \
  -path "./app/about" -prune -o \
  -path "./app/auctions" -prune -o \
  -path "./app/api/holders/\[contract\]" -prune -o \
  -path "./app/api/holders/\[contract\]/route.js" -prune -o \
  -path "./app/api/holders/\[contract\]/progress/route.js" -prune -o \
  -path "./app/api/holders/blockchain" -prune -o \
  -name "ClientProvider.js" -prune -o \
  -name "layout.js" -prune -o \
  -name "mining/page.js" -prune -o \
  -name "nft-contracts.js" -prune -o \
  -name "page.js" -prune -o \
  -name "store.js" -prune -o \
  -type f -name "*.js" -print | sort)



# Manually add the two specific component files
included_files=$(printf "%s\n%s\n%s" "$included_files" "./components/NFTPage.js" "./components/HolderTable.js")

{
  echo "================= Includes the following JS files under ./server ================="
  echo "$included_files"

  echo -e "\n\n================= Excluded JS files ================="
  echo "$excluded_files"

  echo -e "\n\n================= Contents of Included Files ================="
  while IFS= read -r file; do
    echo -e "\n----- $file -----\n"
    cat "$file"
  done <<< "$included_files"

  echo -e "\n\n================= Includes the following JS files under ./server ================="
  echo "$included_files"
} > scripts/out/server_output.txt

clear
cat scripts/out/server_output.txt
