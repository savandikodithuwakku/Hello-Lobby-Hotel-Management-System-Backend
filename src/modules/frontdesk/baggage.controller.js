import { sendCreated, sendOk } from "../../shared/utils/ApiResponse.js";
import asyncHandler from "../../shared/utils/asyncHandler.js";
import * as baggageService from "./baggage.service.js";
import { BAGGAGE_MESSAGES } from "./baggage.constants.js";

export const listBaggage = asyncHandler(async (req, res) => {
  const result = await baggageService.listBaggage(req.validatedQuery, req.user);
  sendOk(res, BAGGAGE_MESSAGES.FETCHED, result);
});

export const getBaggageStatistics = asyncHandler(async (req, res) => {
  const statistics = await baggageService.getBaggageStatistics();
  sendOk(res, "Baggage statistics fetched", statistics);
});

export const getBaggage = asyncHandler(async (req, res) => {
  const baggage = await baggageService.getBaggageById(req.params.id, req.user);
  sendOk(res, "Baggage fetched successfully", { baggage });
});

/** How baggage is actually found at a desk: somebody hands over a paper tag. */
export const getBaggageByTag = asyncHandler(async (req, res) => {
  const baggage = await baggageService.getBaggageByTag(req.params.tag, req.user);
  sendOk(res, "Baggage fetched successfully", { baggage });
});

export const storeBaggage = asyncHandler(async (req, res) => {
  const baggage = await baggageService.storeBaggage(req.user, req.body);

  // The tag is the whole point of the response: it is what gets written on the
  // ticket and handed to the guest.
  sendCreated(res, `${BAGGAGE_MESSAGES.STORED} under ${baggage.tag}`, { baggage });
});

export const updateBaggage = asyncHandler(async (req, res) => {
  const baggage = await baggageService.updateBaggage(req.user, req.params.id, req.body);
  sendOk(res, BAGGAGE_MESSAGES.UPDATED, { baggage });
});

export const collectBaggage = asyncHandler(async (req, res) => {
  const baggage = await baggageService.collectBaggage(req.user, req.params.id, req.body);
  sendOk(res, BAGGAGE_MESSAGES.COLLECTED, { baggage });
});
