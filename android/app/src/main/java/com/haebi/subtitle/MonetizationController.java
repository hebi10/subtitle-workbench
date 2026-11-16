package com.haebi.subtitle;

import android.app.Activity;
import android.view.View;
import android.widget.FrameLayout;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.google.android.gms.ads.AdListener;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.AdSize;
import com.google.android.gms.ads.AdView;
import com.google.android.gms.ads.MobileAds;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.UserMessagingPlatform;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Consumer;

/** Native-only advertising and read-only product discovery; never grants unverified subscriptions. */
final class MonetizationController {
    static final String SUBSCRIPTION_PRODUCT = "subtitle_remove_ads";
    private final Activity activity;
    private final FrameLayout adSlot;
    private final ConsentInformation consent;
    private final BillingClient billing;
    private AdView banner;
    private boolean homeScreen;
    private boolean adLoading;
    private boolean billingConnected;
    private boolean destroyed;

    MonetizationController(Activity activity, FrameLayout slot) {
        this.activity = activity;
        this.adSlot = slot;
        adSlot.setVisibility(View.GONE);
        consent = UserMessagingPlatform.getConsentInformation(activity);
        billing = BillingClient.newBuilder(activity)
                .setListener((result, purchases) -> {
                    // Never trust a purchase callback as a paid entitlement.
                    // Server-side Play Developer API verification is required before ad removal.
                })
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .build();
        requestConsent();
    }

    void setScreen(String screen) {
        homeScreen = "video".equals(screen);
        updateVisibility();
        if (homeScreen) maybeRequestBanner();
    }

    private void requestConsent() {
        consent.requestConsentInfoUpdate(activity, new ConsentRequestParameters.Builder().build(),
                () -> UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity,
                        error -> maybeRequestBanner()),
                error -> maybeRequestBanner());
    }

    void showPrivacyOptions() {
        if (consent.getPrivacyOptionsRequirementStatus()
                == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED) {
            UserMessagingPlatform.showPrivacyOptionsForm(activity, error -> {
                if (banner != null) {
                    banner.destroy();
                    banner = null;
                }
                adLoading = false;
                updateVisibility();
                maybeRequestBanner();
            });
        }
    }

    boolean hasPrivacyOptions() {
        return consent.getPrivacyOptionsRequirementStatus()
                == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED;
    }

    private void maybeRequestBanner() {
        if (destroyed || !homeScreen || !consent.canRequestAds() || adLoading || banner != null) return;
        adLoading = true;
        MobileAds.initialize(activity, status -> {
            if (destroyed) return;
            AdView next = new AdView(activity);
            next.setAdUnitId(activity.getString(R.string.subtitle_banner_ad_unit_id));
            int width = Math.max(320, (int) (activity.getResources().getDisplayMetrics().widthPixels
                    / activity.getResources().getDisplayMetrics().density));
            next.setAdSize(AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(activity, width));
            next.setAdListener(new AdListener() {
                @Override public void onAdLoaded() {
                    adLoading = false;
                    if (!destroyed) updateVisibility();
                }
                @Override public void onAdFailedToLoad(com.google.android.gms.ads.LoadAdError error) {
                    adLoading = false;
                    adSlot.setVisibility(View.GONE);
                }
            });
            adSlot.removeAllViews();
            adSlot.addView(next, new FrameLayout.LayoutParams(-1, -2));
            banner = next;
            next.loadAd(new AdRequest.Builder().build());
        });
    }

    private void updateVisibility() {
        adSlot.setVisibility(homeScreen && banner != null && !adLoading
                && consent.canRequestAds() ? View.VISIBLE : View.GONE);
    }

    void querySubscriptionOptions(Consumer<JSONObject> callback) {
        if (destroyed) return;
        if (!billingConnected) {
            billing.startConnection(new BillingClientStateListener() {
                @Override public void onBillingServiceDisconnected() {
                    billingConnected = false;
                    callback.accept(unavailable());
                }
                @Override public void onBillingSetupFinished(BillingResult result) {
                    billingConnected = result.getResponseCode() == BillingClient.BillingResponseCode.OK;
                    if (billingConnected) queryConnected(callback);
                    else callback.accept(unavailable());
                }
            });
            return;
        }
        queryConnected(callback);
    }

    private void queryConnected(Consumer<JSONObject> callback) {
        List<QueryProductDetailsParams.Product> products = new ArrayList<>();
        products.add(QueryProductDetailsParams.Product.newBuilder()
                .setProductId(SUBSCRIPTION_PRODUCT)
                .setProductType(BillingClient.ProductType.SUBS).build());
        billing.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(products).build(),
                (result, detailsResult) -> {
                    JSONObject output = unavailable();
                    try {
                        JSONArray plans = new JSONArray();
                        if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                            for (ProductDetails detail : detailsResult.getProductDetailsList()) {
                                if (!SUBSCRIPTION_PRODUCT.equals(detail.getProductId())) continue;
                                List<ProductDetails.SubscriptionOfferDetails> offers = detail.getSubscriptionOfferDetails();
                                if (offers == null) continue;
                                for (ProductDetails.SubscriptionOfferDetails offer : offers) {
                                    String plan = offer.getBasePlanId();
                                    if (!"monthly".equals(plan) && !"yearly".equals(plan)) continue;
                                    JSONObject p = new JSONObject().put("basePlanId", plan)
                                            .put("productId", detail.getProductId());
                                    List<ProductDetails.PricingPhase> phases = offer.getPricingPhases().getPricingPhaseList();
                                    if (!phases.isEmpty()) p.put("price", phases.get(0).getFormattedPrice());
                                    plans.put(p);
                                }
                            }
                            output.put("available", plans.length() > 0);
                        }
                        output.put("plans", plans);
                    } catch (Exception ignored) { }
                    callback.accept(output);
                });
    }

    private static JSONObject unavailable() {
        JSONObject json = new JSONObject();
        try {
            json.put("available", false).put("plans", new JSONArray())
                    .put("purchaseEnabled", false).put("entitlementVerified", false);
        } catch (Exception ignored) { }
        return json;
    }

    void destroy() {
        destroyed = true;
        if (banner != null) banner.destroy();
        banner = null;
        billing.endConnection();
    }
}
