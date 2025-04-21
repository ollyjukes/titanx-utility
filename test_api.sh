#!/bin/bash
echo "Testing API Routes..."
for route in Element280 Element369 Stax Ascendant E280; do
  echo "=== $route ==="
  if [ "$route" = "E280" ]; then
    curl -s "http://localhost:3000/api/holders/$route?page=0&pageSize=1" | jq -r '.error // "No error"'
  else
    curl -s "http://localhost:3000/api/holders/$route?page=0&pageSize=1" | jq '{ holdersCount: (.holders | length), totalTokens, summary: (.summary // {} | {totalLive, totalBurned}), rewards: (.holders[0] | {infernoRewards, fluxRewards, e280Rewards, claimableRewards, shares, pendingDay8}) }'
  fi
  echo ""
done
