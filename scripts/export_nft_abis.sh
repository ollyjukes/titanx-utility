#!/bin/bash

# Change to project root
cd "$(dirname "$0")/.." || exit 1

# Explicit list of ABI files
included_files=$(cat <<EOF
./abi/ascendantNFT.json
./abi/element280.json
./abi/element280Vault.json
./abi/element369.json
./abi/element369Vault.json
./abi/staxVault.json
./abi/staxNFT.json
EOF
)

{
  echo "================= Includes the following files under ./abi ================="
  echo "$included_files"

  echo -e "\n\n================= Contents of above files =================\n"

  while IFS= read -r file; do
    if [[ -f "$file" ]]; then
      echo -e "\n----- $file -----\n"
      cat "$file"
    else
      echo -e "\n----- $file -----\n"
      echo "[Warning] File does not exist."
    fi
  done <<< "$included_files"

  echo -e "\n\n================= Includes the following files under ./abi ================="
  echo "$included_files"
} > scripts/out/export_nft_abi_api.txt

clear
cat scripts/out/export_nft_abi_api.txt
