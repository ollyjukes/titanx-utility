#!/bin/bash

# Change to project root
cd "$(dirname "$0")/.." || exit 1

# Dynamically collect file paths
contracts_files=$(find ./contracts -type f | sort)
client_files=$(find ./client/lib -type f | sort)
api_files=$(find ./app/api -type f | sort)
lib_files=$(find ./app/lib -type f | sort)
nft_files=$(find ./app/nft -type f | sort)

# Explicit list of ABI files
abi_files=$(cat <<EOF

EOF
)

# Explicit env file
env_file="./.env.local"

output_file="fetch_code.txt"

{
  echo "================= Included files summary ================="
  echo -e "\n./contracts:"
  echo "$contracts_files"
  echo -e "\n./client:"
  echo "$client_files"
  echo -e "\n./app/api:"
  echo "$api_files"
  echo -e "\n./app/lib:"
  echo "$lib_files"
  echo -e "\n./app/nft:"
  echo "$nft_files"
  echo -e "\n./abi:"
  echo "$abi_files"
  echo -e "\n.env file:"
  echo "$env_file"

  echo -e "\n\n================= Contents of above files =================\n"

  for file in $contracts_files $client_files $api_files $lib_files $nft_files; do
    echo -e "\n----- $file -----\n"
    cat "$file"
  done

  for file in $abi_files; do
    echo -e "\n----- $file -----\n"
    if [[ -f "$file" ]]; then
      cat "$file"
    else
      echo "[Warning] File does not exist."
    fi
  done

  if [[ -f "$env_file" ]]; then
    echo -e "\n----- $env_file -----\n"
    cat "$env_file"
  else
    echo -e "\n----- $env_file -----\n"
    echo "[Warning] File does not exist."
  fi

  echo -e "\n\n================= Included files summary (repeated) ================="
  echo -e "\n./contracts:"
  echo "$contracts_files"
  echo -e "\n./client:"
  echo "$client_files"
  echo -e "\n./app/api:"
  echo "$api_files"
  echo -e "\n./app/lib:"
  echo "$lib_files"
  echo -e "\n./app/nft:"
  echo "$nft_files"
  echo -e "\n./abi:"
  echo "$abi_files"
  echo -e "\n.env file:"
  echo "$env_file"

} > "$output_file"

clear
cat "$output_file"
