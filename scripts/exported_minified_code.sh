#!/bin/bash

cd "$(dirname "$0")/.." || exit 1

# Collect source file lists
contracts_files=$(find ./contracts -type f -name "*.js" | sort)
client_files=$(find ./client/lib -type f -name "*.js" | sort)
api_files=$(find ./app/api -type f -name "*.js" | sort)
lib_files=$(find ./app/lib -type f -name "*.js" | sort)
nft_files=$(find ./app/nft -type f -name "*.js" | sort)

# Explicit ABI JSON files
abi_files=$(cat <<EOF

EOF
)

# Env file
env_file="./.env.local"

output="minified_output.txt"

{
  echo "# Minified Code Export (JS + ABI + .env)"

  for file in $contracts_files $client_files $api_files $lib_files $nft_files; do
    echo -e "\n// --- $file ---"
    sed '/^\s*\/\//d;/\/\*/,/\*\//d;/^\s*$/d;s/^\s*//' "$file"
  done

  for file in $abi_files; do
    echo -e "\n// --- $file ---"
    if [[ -f "$file" ]]; then
      jq -c . "$file"
    else
      echo "[Missing ABI file: $file]"
    fi
  done

  if [[ -f "$env_file" ]]; then
    echo -e "\n# .env.local"
    grep -v '^#' "$env_file" | grep -v '^\s*$'
  else
    echo -e "\n[Missing .env.local]"
  fi
} > scripts/out/$output

clear
cat scripts/out/$output
