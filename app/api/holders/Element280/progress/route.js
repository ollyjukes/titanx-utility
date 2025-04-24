// /app/api/holders/Element280/progress/route.js
import { NextResponse } from "next/server";
import { log } from "@/app/api/utils";
import { getCacheState } from "../route";
import { contractAddresses } from "@/app/nft-contracts";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const address = contractAddresses.element280.address;
  if (!address) {
    log(`[element280] [ERROR] Element280 contract address not found`);
    return NextResponse.json({ error: "Element280 contract address not found" }, { status: 400 });
  }

  try {
    log(`[element280] [STAGE] Handling /progress for ${address}`);
    const { isCachePopulating, totalOwners, progressState, debugId } = await getCacheState(address);
    const totalLiveHolders = totalOwners;
    const progressPercentage =
      progressState.totalNfts > 0
        ? ((progressState.processedNfts / progressState.totalNfts) * 100).toFixed(1)
        : "0.0";
    const phase =
      progressState.step === "completed"
        ? "Completed"
        : progressState.step === "idle"
        ? "Idle"
        : progressState.step === "error"
        ? "Error"
        : "In Progress";

    const response = {
      isPopulating: isCachePopulating,
      totalLiveHolders,
      totalOwners,
      phase,
      progressPercentage,
    };

    log(`[element280] [PROD_DEBUG] Handling /progress for ${address}: isPopulating=${isCachePopulating}, totalLiveHolders=${totalLiveHolders}, totalOwners=${totalOwners}, step=${progressState.step}, phase=${phase}, progressPercentage=${progressPercentage}, debugId=${debugId}`);
    return NextResponse.json(response);
  } catch (error) {
    log(`[element280] [ERROR] Error in GET /progress for ${address}: ${error.message}, stack: ${error.stack}`);
    return NextResponse.json({ error: `Server error: ${error.message}` }, { status: 500 });
  }
}