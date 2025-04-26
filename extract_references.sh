#!/bin/bash
# Ensure import_statements.txt exists
if [ ! -f "import_statements.txt" ]; then
  echo "Error: import_statements.txt not found" >&2
  exit 1
fi

# Debug: Show number of import statements
echo "Number of import statements:" >&2
wc -l import_statements.txt >&2

# Extract lines with local imports (./, ../, or @/)
echo "Extracting local imports..." >&2
grep -E "import.*from.*([\./]|@/).*" import_statements.txt > temp_imports.txt 2>grep_error.log
if [ ! -s temp_imports.txt ]; then
  echo "Error: No local imports found. Check grep_error.log" >&2
  cat grep_error.log >&2
  exit 1
fi
echo "Local imports found: $(wc -l < temp_imports.txt)" >&2
echo "First 5 local imports:" >&2
head -n 5 temp_imports.txt >&2

# Process import statements
echo "Processing import statements..." >&2
# Initialize temp_referenced.txt
: > temp_referenced.txt
# Handle regular imports
sed -E "s|.*from\s*['\"]([\./@][^'\"]+)['\"];$|\1|" temp_imports.txt >> temp_referenced.txt 2>sed_import_error.log
# Handle JSON imports with assert
sed -E "s|.*from\s*['\"]([\./@][^'\"]+)['\"]\s*assert.*$|\1|" temp_imports.txt >> temp_referenced.txt 2>>sed_import_error.log
# Remove lines that didn't match (contain colons or full statements)
sed -i '' '/:/d' temp_referenced.txt 2>>sed_import_error.log
# Check if temp_referenced.txt is empty
if [ ! -s temp_referenced.txt ]; then
  echo "Error: Failed to process imports. Check sed_import_error.log" >&2
  cat sed_import_error.log >&2
  echo "Dumping temp_referenced.txt for debugging:" >&2
  cat temp_referenced.txt >&2
  exit 1
fi
echo "First 5 processed imports:" >&2
head -n 5 temp_referenced.txt >&2

# Remove duplicates and sort
echo "Finalizing referenced files..." >&2
sort -u temp_referenced.txt > referenced_files.txt 2>sort_error.log
if [ ! -s referenced_files.txt ]; then
  echo "Error: Failed to finalize referenced files. Check sort_error.log" >&2
  cat sort_error.log >&2
  exit 1
fi

# Clean up
rm temp_imports.txt temp_referenced.txt 2>/dev/null
echo "Generated referenced_files.txt" >&2
cat referenced_files.txt
