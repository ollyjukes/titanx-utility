#!/bin/bash

# Enhanced curls.sh for testing TitanX Utility API endpoints
# Features: JSON formatting, retries, timestamps, error handling, verbose output

# Configuration
BASE_URL="http://localhost:3000"
LOG_FILE="test.log"
RETRY_COUNT=3
RETRY_DELAY=5
PAGE_SIZE=100

# Ensure jq is installed
if ! command -v jq &> /dev/null; then
  echo "Error: jq is required. Install it with 'sudo apt-get install jq' (Ubuntu) or 'brew install jq' (macOS)."
  exit 1
fi

# Clear previous log
> "$LOG_FILE"

# Function to log messages
log() {
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  echo "[$timestamp] $1" | tee -a "$LOG_FILE"
}

# Function to make curl request with retries and JSON formatting
curl_with_retry() {
  local url="$1"
  local method="${2:-GET}"
  local attempt=1
  local response
  local status_code

  while [ $attempt -le $RETRY_COUNT ]; do
    log "Attempt $attempt/$RETRY_COUNT: $method $url"
    response=$(curl -s -v -X "$method" "$url" -w "\n%{http_code}" 2>> "$LOG_FILE")
    status_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')

    # Check if response is valid JSON
    if echo "$body" | jq . >/dev/null 2>&1; then
      log "Response (HTTP $status_code):"
      echo "$body" | jq . | tee -a "$LOG_FILE"
    else
      log "Response (HTTP $status_code, non-JSON):"
      echo "$body" | tee -a "$LOG_FILE"
    fi

    # Success (200-299)
    if [[ "$status_code" =~ ^2[0-9]{2}$ ]]; then
      return 0
    # Retry on rate limit (429) or server errors (5xx)
    elif [[ "$status_code" == "429" || "$status_code" =~ ^5[0-9]{2}$ ]]; then
      log "Error: HTTP $status_code, retrying after $RETRY_DELAY seconds..."
      sleep $RETRY_DELAY
      ((attempt++))
    else
      log "Error: HTTP $status_code, stopping retries."
      return 1
    fi
  done

  log "Failed after $RETRY_COUNT attempts: $method $url"
  return 1
}

# Clear terminal
clear

# Test suite
log "Starting TitanX Utility API tests"

# Element280 Tests
log "Test 1: Element280 Progress"
curl_with_retry "$BASE_URL/api/holders/Element280/progress"

log "Test 2: Element280 POST"
curl_with_retry "$BASE_URL/api/holders/Element280" "POST"

log "Test 3: Element280 Holders (page=0, pageSize=$PAGE_SIZE)"
curl_with_retry "$BASE_URL/api/holders/Element280?page=0&pageSize=$PAGE_SIZE"

log "Test 4: Element280 Progress (post-holders)"
curl_with_retry "$BASE_URL/api/holders/Element280/progress"

log "Test 5: Element280 Validate Burned"
curl_with_retry "$BASE_URL/api/holders/Element280/validate-burned"

# Other NFT Collections
log "Test 6: Element369 Holders (page=0, pageSize=$PAGE_SIZE)"
curl_with_retry "$BASE_URL/api/holders/Element369?page=0&pageSize=$PAGE_SIZE"

log "Test 7: Stax Holders (page=0, pageSize=$PAGE_SIZE)"
curl_with_retry "$BASE_URL/api/holders/Stax?page=0&pageSize=$PAGE_SIZE"

log "Test 8: Ascendant Holders (page=0, pageSize=$PAGE_SIZE)"
curl_with_retry "$BASE_URL/api/holders/Ascendant?page=0&pageSize=$PAGE_SIZE"

log "Test 9: E280 Holders (page=0, pageSize=$PAGE_SIZE)"
curl_with_retry "$BASE_URL/api/holders/E280?page=0&pageSize=$PAGE_SIZE"

# Optional: Wallet-specific query (uncomment and replace WALLET_ADDRESS)
# log "Test 10: Element280 Wallet-specific"
# WALLET_ADDRESS="0xYourWalletAddressHere"
# curl_with_retry "$BASE_URL/api/holders/Element280?wallet=$WALLET_ADDRESS"

log "Tests completed. Output saved to $LOG_FILE"
