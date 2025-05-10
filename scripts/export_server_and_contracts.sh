#!/bin/bash

cd "$(dirname "$0")/.." || exit 1

# Define excluded paths for pruning
excluded_paths=(
  "./app/old"
  "./app/api/holders/[contract]"
)

# Manual files to exclude
manual_excluded_files=$(cat <<EOF
./app/about/page.js
./app/auctions/page.js
./app/mining/page.js
./components/Dialog.js
./components/ShootingStars.js
EOF
)

# Excluded files from excluded paths (if needed)
excluded_files=$(find "${excluded_paths[@]}" -type f 2>/dev/null | sort)

# Build included_files list using find
included_files=$(find ./app ./components \
  -path "./app/old" -prune -o \
  -name "ClientProvider.js" -prune -o \
  -name "nft-contracts.js" -prune -o \
  -name "contracts.js" -prune -o \
  -type f -name "*.js" -print)

# Add all .js files from app/nft explicitly
nft_files=$(find ./app/nft -type f -name "*.js")

# Combine, add .env.local, deduplicate
combined_files=$(printf "%s\n%s\n%s" "$included_files" "$nft_files" "./.env.local" | sort -u)

# Filter out the manually excluded files
final_included_files=$(echo "$combined_files" | grep -v -F -x "$manual_excluded_files")

# Output
{
  echo "================= Includes the following JS files under ./server ================="
  echo "$final_included_files"

  echo -e "\n\n================= Manually Excluded JS files ================="
  echo "$manual_excluded_files"

  echo -e "\n\n================= Contents of Included Files ================="
  while IFS= read -r file; do
    echo -e "\n----- $file -----\n"
    cat "$file"
  done <<< "$final_included_files"

  echo -e "\n\n================= Final Summary of Included Files ================="
  echo "$final_included_files"
} > scripts/out/server_output.txt

clear
cat scripts/out/server_output.txt
