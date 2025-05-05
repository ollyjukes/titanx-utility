#!/bin/bash

# Change to script directory to ensure relative paths work
cd "$(dirname "$0")" || exit 1

# Define the list of export scripts
scripts=(
  "export_config_env.sh"
  "export_server_output.sh"
  "export_server_and_contracts.sh"
  "export_app.sh"
  "export_client.sh"
  "export_contracts_abis.sh"
  "export_tests.sh"
  "export_client_app.sh"
  "export_nft_abis.sh"

)

# Run each script
for script in "${scripts[@]}"; do
  echo -e "\n\n================= Running: $script =================\n"
  bash "./$script"
done

