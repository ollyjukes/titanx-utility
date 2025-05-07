#!/bin/bash

# Change to project root
cd "$(dirname "$0")/.." || exit 1

# Dynamically collect all files under ./contracts
contracts_files=$(find ./contracts -type f | sort)

# Explicit list of ABI files
abi_files=$(cat <<EOF
./abi/ascendantNFT.json
./abi/element280.json
./abi/element280Vault.json
./abi/element369.json
./abi/element369Vault.json

EOF
)

#./abi/staxVault.json
#./abi/staxNFT.json


{
  echo "================= Includes the following files under ./contracts ================="
  echo "$contracts_files"

  echo -e "\n\n================= Includes the following files under ./abi ================="
  echo "$abi_files"

  echo -e "\n\n================= Contents of above files =================\n"

  for file in $contracts_files; do
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

  echo -e "\n\n================= Includes the following files under ./contracts ================="
  echo "$contracts_files"

  echo -e "\n\n================= Includes the following files under ./abi ================="
  echo "$abi_files"

} > scripts/out/contracts_and_abi_output.txt

clear
cat scripts/out/contracts_and_abi_output.txt
