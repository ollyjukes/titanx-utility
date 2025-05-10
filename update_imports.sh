#!/bin/bash

# Define the directory to search (project root or app/)
SEARCH_DIR="app"

# Define the old and new import statements
OLD_IMPORT="import config from '@/app/contracts_nft';"
NEW_IMPORT="import config from '@/app/contracts/contracts_nft';"

# Escape special characters for sed
ESCAPED_OLD_IMPORT=$(echo "$OLD_IMPORT" | sed 's/[\/&]/\\&/g')
ESCAPED_NEW_IMPORT=$(echo "$NEW_IMPORT" | sed 's/[\/&]/\\&/g')

# Find all JavaScript files containing the old import and replace it
echo "Searching for files containing: $OLD_IMPORT"
FILES=$(grep -rl --include="*.js" "$OLD_IMPORT" "$SEARCH_DIR")

if [ -z "$FILES" ]; then
  echo "No files found with the import statement: $OLD_IMPORT"
  exit 0
fi

echo "Found the following files:"
echo "$FILES"
echo ""

# Loop through each file and perform the replacement
for FILE in $FILES; do
  echo "Updating $FILE..."
  # Use sed to replace the import statement
  sed -i '' "s/$ESCAPED_OLD_IMPORT/$ESCAPED_NEW_IMPORT/g" "$FILE"
  if [ $? -eq 0 ]; then
    echo "Successfully updated $FILE"
  else
    echo "Failed to update $FILE"
  fi
done

echo ""
echo "Replacement complete. Please verify the changes and rebuild your project."