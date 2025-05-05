#!/bin/bash

# Change to project root
cd "$(dirname "$0")/.." || exit 1

# Collect all files (not just .js) from ./app
included_files=$(find ./client -type f | sort)

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
} > client_dir_output.txt

clear
cat client_dir_output.txt

