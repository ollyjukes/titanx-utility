#!/bin/bash

# Change to project root
cd "$(dirname "$0")/.." || exit 1

# Collect all files (not just .js) from ./app
included_files=$(find ./client ./app  -type f  -name "*.js" | sort)
#included_files=$(find ./client ./app -not -path "app/api/*" -not -path "app/lib/*" -type f  -name "*.js" | sort)

{
  echo "================= Includes the following files under ./app ================="
  echo "$included_files"

  echo -e "\n\n================= Contents of above files =================\n"

  while IFS= read -r file; do
    echo -e "\n----- $file -----\n"
    cat "$file"
  done <<< "$included_files"

  echo -e "\n\n================= Includes the following files under ./app ================="
  echo "$included_files"
} > scripts/out/client_and_app_output.txt

clear
cat scripts/out/client_and_app_output.txt

