#!/bin/bash

cd "$(dirname "$0")/.." || exit 1

# Define excluded paths for pruning
excluded_paths=(
  "./app/old"
  "./app/api/holders/[contract]"
)

# Excluded files manually listed (can be expanded)
excluded_files=$(find "${excluded_paths[@]}" -type f -name "ClientProvider.js" 2>/dev/null | sort)

# Build included_files list using find
included_files=$(find ./app ./components \
  -path "./app/old" -prune -o \
  -path "./app/api/holders/[contract]" -prune -o \
  -name "ClientProvider.js" -prune -o \
  -name "nft-contracts.js" -prune -o \
   -name "contracts.js" -prune -o \
  -name "page.js" -prune -o \
  -name "store.js" -prune -o \
  -type f -name "*.js" -print)

# Add all .js files from app/nft explicitly to ensure they are included
nft_files=$(find ./app/nft -type f -name "*.js")

# Merge everything (removing duplicates) + .env.local + specific components
included_files=$(printf "%s\n%s\n%s\n%s\n" "$included_files" "$nft_files" "./.env.local" "./components/NFTPage.js" "./components/HolderTable.js" | sort -u)

# Write to output file
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

  echo -e "\n\n================= Final Summary of Included Files ================="
  echo "$included_files"
} > scripts/out/server_output.txt

clear
cat scripts/out/server_output.txt
