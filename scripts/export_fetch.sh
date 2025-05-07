#!/bin/bash

# Change to project root
cd "$(dirname "$0")/.." || exit 1

# Dynamically collect file paths
contracts_files=$(find ./contracts -type f | sort)
client_files=$(find ./client ./app -type f | sort)
#api_files=$(find ./app/api -type f | sort)
#lib_files=$(find ./app/lib -type f | sort)
#nft_files=$(find ./app/nft -type f | sort)

# Explicit list of ABI files
abi_files=$(cat <<EOF

EOF
)

# Explicit env file
env_file="./.env.local"

output_file="scripts/out/fetch_code.txt"


{
  echo "================= Included files summary ================="
  echo "$contracts_files"
  echo "$client_files"
  echo "$env_file"

  echo -e "\n\n================= Contents of above files =================\n"

  for file in $contracts_files $client_files ; do
    echo -e "\n----- $file -----\n"
    cat "$file"
  done


  if [[ -f "$env_file" ]]; then
    echo -e "\n----- $env_file -----\n"
    cat "$env_file"
  else
    echo -e "\n----- $env_file -----\n"
    echo "[Warning] File does not exist."
  fi

  echo -e "\n\n================= Included files summary (repeated) ================="
  echo "$contracts_files"
  echo "$client_files"
  echo "$env_file"

} > "$output_file"

clear
cat "$output_file"
