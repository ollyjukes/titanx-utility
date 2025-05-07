#!/bin/bash

# Change to project root
cd "$(dirname "$0")/.." || exit 1

# Find all files under ./app and ./components, excluding ./app/api
included_files=$(find ./app ./components \
    -path "./app/api" -prune -o \
      -path "./app/dev" -prune -o \
  -type f -print | sort)

{
  echo "================= Includes the following files under ./app and ./components ================="
  echo "$included_files"

  echo -e "\n\n================= Contents of above files =================\n"

  while IFS= read -r file; do
    echo -e "\n----- $file -----\n"
    cat "$file"
  done <<< "$included_files"

  echo -e "\n\n================= Includes the following files under ./app and ./components ================="
  echo "$included_files"
} > scripts/out/app_output.txt

clear
cat scripts/out/app_output.txt
