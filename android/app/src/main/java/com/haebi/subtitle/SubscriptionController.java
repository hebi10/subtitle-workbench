package com.haebi.subtitle;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class SubscriptionController {
    private static final String PRODUCT = "subtitle_remove_ads";
    private static final List<String> PLANS = Arrays.asList("monthly", "yearly");
    private static final QueryPurchasesParams PURCHASES = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.SUBS).build();
    private static final QueryProductDetailsParams PRODUCTS = QueryProductDetailsParams.newBuilder()
            .setProductList(Collections.singletonList(QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(PRODUCT).setProductType(BillingClient.ProductType.SUBS).build())).build();

    private final Activity activity;
    private final BillingClient billing;
    private final SubscriptionVerifier verifier;
    private final Runnable stateChanged;
    private final List<Consumer<Boolean>> connecting = new ArrayList<>();
    private final List<Consumer<Boolean>> refreshWaiters = new ArrayList<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable expiry = () -> setGrant(0);
    private final Runnable recheck = () -> refresh(false, result -> {});
    private long verifiedUntil;
    private boolean refreshing;
    private boolean resumePending;
    private boolean resumed;
    private boolean purchaseFlow;
    private boolean pendingPurchase;
    private boolean hasPurchase;
    private boolean destroyed;

    SubscriptionController(Activity activity, Runnable stateChanged) {
        this.activity = activity;
        this.stateChanged = stateChanged;
        verifier = new SubscriptionVerifier(activity);
        billing = BillingClient.newBuilder(activity)
                .setListener((result, purchases) -> activity.runOnUiThread(() -> {
                    purchaseFlow = false;
                    if (destroyed) return;
                    if (ok(result) || result.getResponseCode() == BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED) {
                        resumePending = refreshing;
                        refresh(false, ignored -> stateChanged.run());
                    }
                }))
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .enableAutoServiceReconnection()
                .build();
    }

    boolean verified() { return verifiedUntil > SystemClock.elapsedRealtime(); }

    void resume() {
        resumed = true;
        if (verifier.configured()) refresh(false, result -> {});
    }

    void pause() {
        resumed = false;
        handler.removeCallbacks(recheck);
    }

    private void withBilling(Consumer<Boolean> action) {
        if (destroyed) return;
        if (billing.isReady()) { action.accept(true); return; }
        connecting.add(action);
        if (connecting.size() > 1) return;
        billing.startConnection(new BillingClientStateListener() {
            @Override public void onBillingSetupFinished(BillingResult result) {
                activity.runOnUiThread(() -> finishConnection(ok(result)));
            }
            @Override public void onBillingServiceDisconnected() {
                activity.runOnUiThread(() -> finishConnection(false));
            }
        });
    }

    private void finishConnection(boolean ready) {
        List<Consumer<Boolean>> callbacks = new ArrayList<>(connecting);
        connecting.clear();
        if (!destroyed) callbacks.forEach(action -> action.accept(ready));
    }

    private void loadOffers(Consumer<Map<String, Offer>> callback) {
        withBilling(ready -> {
            if (!ready) { callback.accept(Collections.emptyMap()); return; }
            billing.queryProductDetailsAsync(PRODUCTS, (result, details) -> activity.runOnUiThread(() -> {
                if (destroyed) return;
                Map<String, Offer> offers = new LinkedHashMap<>();
                if (ok(result)) for (ProductDetails product : details.getProductDetailsList()) {
                    if (!PRODUCT.equals(product.getProductId()) || product.getSubscriptionOfferDetails() == null) continue;
                    for (ProductDetails.SubscriptionOfferDetails plan : product.getSubscriptionOfferDetails()) {
                        if (!PLANS.contains(plan.getBasePlanId()) || plan.getOfferId() != null) continue;
                        List<ProductDetails.PricingPhase> phases = plan.getPricingPhases().getPricingPhaseList();
                        if (phases.size() != 1) continue;
                        ProductDetails.PricingPhase phase = phases.get(0);
                        String period = "monthly".equals(plan.getBasePlanId()) ? "P1M" : "P1Y";
                        if (!period.equals(phase.getBillingPeriod())
                                || phase.getRecurrenceMode() != ProductDetails.RecurrenceMode.INFINITE_RECURRING) continue;
                        offers.put(plan.getBasePlanId(), new Offer(product, plan.getOfferToken(), phase.getFormattedPrice()));
                    }
                }
                callback.accept(offers);
            }));
        });
    }

    void options(Consumer<JSONObject> callback) {
        loadOffers(offers -> refresh(!offers.isEmpty(), ready -> callback.accept(optionsJson(offers, ready))));
    }

    void restore(Consumer<JSONObject> callback) {
        refresh(false, ready -> callback.accept(optionsJson(Collections.emptyMap(), ready)));
    }

    private JSONObject optionsJson(Map<String, Offer> offers, boolean ready) {
        JSONObject output = new JSONObject();
        JSONArray plans = new JSONArray();
        try {
            for (String plan : PLANS) {
                Offer offer = offers.get(plan);
                if (offer != null) plans.put(new JSONObject().put("basePlanId", plan).put("price", offer.price));
            }
            output.put("plans", plans).put("available", !offers.isEmpty())
                    .put("purchaseEnabled", ready && !hasPurchase && !pendingPurchase && !purchaseFlow && !offers.isEmpty())
                    .put("entitlementVerified", verified()).put("pending", pendingPurchase)
                    .put("verificationAvailable", ready).put("hasPurchase", hasPurchase)
                    .put("verificationConfigured", verifier.configured());
        } catch (JSONException ignored) { /* Only fixed keys and SDK strings are serialized. */ }
        return output;
    }

    void buy(String plan, BooleanSupplier onSettings, Consumer<Boolean> callback) {
        if (!verifier.configured() || !PLANS.contains(plan) || purchaseFlow) { callback.accept(false); return; }
        purchaseFlow = true;
        loadOffers(offers -> {
            Offer offer = offers.get(plan);
            if (offer == null) { finishLaunch(false, callback); return; }
            refresh(true, ready -> {
                if (!ready || hasPurchase || pendingPurchase || !resumed || !onSettings.getAsBoolean()) {
                    finishLaunch(false, callback);
                    return;
                }
                BillingFlowParams.ProductDetailsParams item = BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(offer.product).setOfferToken(offer.token).build();
                BillingFlowParams params = BillingFlowParams.newBuilder().setProductDetailsParamsList(Collections.singletonList(item)).build();
                finishLaunch(ok(billing.launchBillingFlow(activity, params)), callback);
            });
        });
    }

    private void finishLaunch(boolean launched, Consumer<Boolean> callback) {
        purchaseFlow = launched;
        callback.accept(launched);
    }

    boolean manage() {
        Uri url = Uri.parse("https://play.google.com/store/account/subscriptions")
                .buildUpon().appendQueryParameter("sku", PRODUCT)
                .appendQueryParameter("package", activity.getPackageName()).build();
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, url));
            return true;
        } catch (ActivityNotFoundException error) {
            return false;
        }
    }

    private void refresh(boolean checkCatalog, Consumer<Boolean> callback) {
        if (destroyed) return;
        if (!verifier.configured()) { callback.accept(false); return; }
        if (refreshing && checkCatalog) {
            refreshWaiters.add(result -> refresh(true, callback));
            return;
        }
        refreshWaiters.add(callback);
        if (refreshing) return;
        refreshing = true;
        withBilling(ready -> {
            if (!ready) { finishRefresh(-1); return; }
            billing.queryPurchasesAsync(PURCHASES, (result, purchases) -> activity.runOnUiThread(() -> {
                if (destroyed) return;
                if (!ok(result)) { finishRefresh(-1); return; }
                TreeSet<String> tokens = new TreeSet<>();
                pendingPurchase = false;
                for (Purchase purchase : purchases) {
                    if (!purchase.getProducts().contains(PRODUCT)) continue;
                    if (purchase.getPurchaseState() == Purchase.PurchaseState.PENDING) pendingPurchase = true;
                    if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED) tokens.add(purchase.getPurchaseToken());
                }
                hasPurchase = !tokens.isEmpty();
                if (tokens.isEmpty() && !checkCatalog) { finishRefresh(0); return; }
                verifier.verify(new ArrayList<>(tokens), validity -> activity.runOnUiThread(() -> finishRefresh(validity)));
            }));
        });
    }

    private void finishRefresh(long validity) {
        if (destroyed) return;
        refreshing = false;
        setGrant(validity);
        List<Consumer<Boolean>> callbacks = new ArrayList<>(refreshWaiters);
        refreshWaiters.clear();
        callbacks.forEach(callback -> callback.accept(validity >= 0));
        if (resumePending) { resumePending = false; refresh(false, result -> {}); }
    }

    private void setGrant(long validity) {
        handler.removeCallbacks(expiry);
        handler.removeCallbacks(recheck);
        verifiedUntil = validity > 0 ? SystemClock.elapsedRealtime() + validity : 0;
        if (validity > 0) {
            handler.postDelayed(expiry, validity);
            if (resumed && validity > 60000) handler.postDelayed(recheck, validity - 60000);
        }
        stateChanged.run();
    }

    void destroy() {
        destroyed = true;
        handler.removeCallbacksAndMessages(null);
        connecting.clear();
        refreshWaiters.clear();
        billing.endConnection();
        verifier.destroy();
    }

    private static boolean ok(BillingResult result) {
        return result.getResponseCode() == BillingClient.BillingResponseCode.OK;
    }

    private static final class Offer {
        final ProductDetails product;
        final String token;
        final String price;

        Offer(ProductDetails product, String token, String price) {
            this.product = product;
            this.token = token;
            this.price = price;
        }
    }
}
