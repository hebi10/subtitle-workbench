package com.haebi.subtitle;

import android.app.Activity;
import android.view.View;
import android.widget.FrameLayout;
import com.google.android.gms.ads.AdListener;
import com.google.android.gms.ads.AdRequest;
import com.google.android.gms.ads.AdSize;
import com.google.android.gms.ads.AdView;
import com.google.android.gms.ads.MobileAds;
import com.google.android.ump.ConsentInformation;
import com.google.android.ump.ConsentRequestParameters;
import com.google.android.ump.UserMessagingPlatform;
import org.json.JSONObject;
import java.util.function.Consumer;

final class MonetizationController {
    private final Activity activity;
    private final FrameLayout adSlot;
    private final ConsentInformation consent;
    private final SubscriptionController subscriptions;
    private AdView banner;
    private String screen = "";
    private boolean resumed;
    private boolean adLoading;
    private boolean bannerLoaded;
    private boolean destroyed;

    MonetizationController(Activity activity, FrameLayout slot, Runnable subscriptionChanged) {
        this.activity = activity;
        this.adSlot = slot;
        adSlot.setVisibility(View.GONE);
        consent = UserMessagingPlatform.getConsentInformation(activity);
        subscriptions = new SubscriptionController(activity, () -> {
            if (subscriptionsVerified()) destroyBanner();
            updateVisibility();
            maybeRequestBanner();
            subscriptionChanged.run();
        });
        requestConsent();
    }

    private boolean subscriptionsVerified() { return subscriptions.verified(); }

    void setScreen(String screen) {
        this.screen = screen;
        updateVisibility();
        maybeRequestBanner();
    }

    private void requestConsent() {
        consent.requestConsentInfoUpdate(activity, new ConsentRequestParameters.Builder().build(),
                () -> UserMessagingPlatform.loadAndShowConsentFormIfRequired(activity,
                        error -> maybeRequestBanner()),
                error -> maybeRequestBanner());
    }

    boolean showPrivacyOptions() {
        if (consent.getPrivacyOptionsRequirementStatus()
                == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED) {
            UserMessagingPlatform.showPrivacyOptionsForm(activity, error -> {
                destroyBanner();
                updateVisibility();
                maybeRequestBanner();
            });
            return true;
        }
        return false;
    }

    boolean hasPrivacyOptions() {
        return consent.getPrivacyOptionsRequirementStatus()
                == ConsentInformation.PrivacyOptionsRequirementStatus.REQUIRED;
    }

    private boolean canShowAds() {
        return resumed && !destroyed && "video".equals(screen) && consent.canRequestAds() && !subscriptionsVerified();
    }

    private void maybeRequestBanner() {
        if (!canShowAds() || adLoading || banner != null) return;
        adLoading = true;
        MobileAds.initialize(activity, status -> activity.runOnUiThread(() -> {
            if (!canShowAds()) { adLoading = false; return; }
            AdView next = new AdView(activity);
            next.setAdUnitId(activity.getString(R.string.subtitle_banner_ad_unit_id));
            int widthPx = ((View) adSlot.getParent()).getWidth();
            if (widthPx <= 0) widthPx = activity.getResources().getDisplayMetrics().widthPixels;
            int width = Math.max(1, (int) (widthPx / activity.getResources().getDisplayMetrics().density));
            next.setAdSize(AdSize.getCurrentOrientationAnchoredAdaptiveBannerAdSize(activity, width));
            next.setAdListener(new AdListener() {
                @Override public void onAdLoaded() {
                    if (banner != next) return;
                    adLoading = false;
                    bannerLoaded = true;
                    updateVisibility();
                }
                @Override public void onAdFailedToLoad(com.google.android.gms.ads.LoadAdError error) {
                    if (banner == next) destroyBanner();
                }
            });
            adSlot.addView(next, new FrameLayout.LayoutParams(-1, -2));
            banner = next;
            next.loadAd(new AdRequest.Builder().build());
        }));
    }

    private void updateVisibility() {
        boolean visible = canShowAds() && bannerLoaded;
        adSlot.setVisibility(visible ? View.VISIBLE : View.GONE);
        if (banner != null) {
            if (visible) banner.resume();
            else banner.pause();
        }
    }

    private void destroyBanner() {
        adSlot.setVisibility(View.GONE);
        if (banner != null) {
            AdView current = banner;
            banner = null;
            adSlot.removeView(current);
            current.destroy();
        }
        adLoading = false;
        bannerLoaded = false;
    }

    void querySubscriptionOptions(Consumer<JSONObject> callback) { subscriptions.options(callback); }
    void restoreSubscription(Consumer<JSONObject> callback) { subscriptions.restore(callback); }
    void buySubscription(String plan, Consumer<Boolean> callback) {
        subscriptions.buy(plan, () -> "settings".equals(screen), callback);
    }
    boolean manageSubscription() { return subscriptions.manage(); }
    boolean subscriptionVerified() { return subscriptions.verified(); }

    void resume() {
        resumed = true;
        subscriptions.resume();
        updateVisibility();
        maybeRequestBanner();
    }

    void pause() {
        resumed = false;
        subscriptions.pause();
        updateVisibility();
    }

    void destroy() {
        destroyed = true;
        destroyBanner();
        subscriptions.destroy();
    }
}
