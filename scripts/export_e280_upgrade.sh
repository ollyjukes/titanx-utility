#!/bin/bash

# Change to project root
cd "$(dirname "$0")/.." || exit 1

# Collect all .js files in ./server and ./contracts
included_files=$(find app/api/holders/Element280 app/api/holders/utils app/lib contracts .env.local scripts/test_E280_nft_holders.js -type f -name "*.js" | sort)

{
  echo "================= Includes the following JS files for e280 integration ================="
  echo "$included_files"

  echo -e "\n\n================= Contents of above files =================\n"

  while IFS= read -r file; do
    echo -e "\n----- $file -----\n"
    cat "$file"
  done <<< "$included_files"

  echo -e "\n\n================= Includes the following JS files for e280 integration  ================="
  echo "$included_files"
} > scripts/out/e280_int.txt

clear
cat scripts/out/e280_int.txt

