

for i in {1..12}; do
  echo "Check $i (after $((i*5)) seconds):"
  curl -s "http://localhost:3000/api/holders/Element280/progress" | jq .
  sleep 5
done
