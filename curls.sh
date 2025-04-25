clear;
echo "first check"
curl http://localhost:3000/api/holders/Element280/progress
echo "second"
curl -X POST http://localhost:3000/api/holders/Element280

echo "Third curl"
curl -v "http://localhost:3000/api/holders/Element280?page=0&pageSize=100"
echo "Forth curl"
curl http://localhost:3000/api/holders/Element280/progress
echo "Fifth curl"
curl http://localhost:3000/api/holders/Element280/validate-burned



echo "Other  curls for other NFT collections"
curl -v "http://localhost:3000/api/holders/Element369?page=0&pageSize=100"
curl -v "http://localhost:3000/api/holders/Stax?page=0&pageSize=100"
curl -v "http://localhost:3000/api/holders/Ascendant?page=0&pageSize=100"
curl -v "http://localhost:3000/api/holders/E280?page=0&pageSize=100"
