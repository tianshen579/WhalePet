package io.github.tianshen579.whalepet;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.*;
import java.io.InputStream;

public final class MainActivity extends Activity {
    private TextView status;
    private int dp(float n) { return Math.round(n * getResources().getDisplayMetrics().density); }
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(24), dp(28), dp(24), dp(30));
        root.setBackgroundColor(Color.rgb(242,247,253));
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(dp(24), dp(28) + insets.getSystemWindowInsetTop(), dp(24), dp(30) + insets.getSystemWindowInsetBottom());
            return insets;
        });
        scroll.addView(root); setContentView(scroll);
        text(root, "小鲸鱼的口袋海洋", 25);
        text(root, "她喜欢白米饭，也喜欢你摸摸头。", 15);
        ImageView image = new ImageView(this);
        try (InputStream in = getAssets().open("idle.png")) { image.setImageDrawable(Drawable.createFromStream(in, null)); } catch (Exception ignored) {}
        image.setScaleType(ImageView.ScaleType.FIT_CENTER);
        root.addView(image, new LinearLayout.LayoutParams(-1, dp(230)));
        status = text(root, "", 14);
        button(root, "① 允许显示在其他应用上层", v -> {
            try { startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()))); }
            catch (Exception e) { startActivity(new Intent(Settings.ACTION_SETTINGS)); }
        });
        button(root, "② 叫小鲸鱼出来", v -> {
            if (!Settings.canDrawOverlays(this)) { Toast.makeText(this, "先完成上面的悬浮窗授权，再点击启动。", Toast.LENGTH_LONG).show(); return; }
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 5);
            try { startForegroundService(new Intent(this, PetService.class)); Toast.makeText(this, "小鲸鱼正在出来，长按她可以打开菜单。", Toast.LENGTH_LONG).show(); }
            catch (RuntimeException e) { Toast.makeText(this, "启动未成功，请保持此页面在前台后重试。", Toast.LENGTH_LONG).show(); }
        });
        button(root, "收起宠物", v -> stopService(new Intent(this, PetService.class)));
        text(root, "宠物大小（重新叫出来后生效）", 14);
        SeekBar size = new SeekBar(this); size.setMax(120);
        size.setProgress(getSharedPreferences("pet",0).getInt("size",180)-140);
        root.addView(size);
        size.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar bar,int value,boolean user) { if(user)getSharedPreferences("pet",0).edit().putInt("size",140+value).apply(); }
            public void onStartTrackingTouch(SeekBar bar) {}
            public void onStopTrackingTouch(SeekBar bar) {}
        });
        text(root, "点一下：摸头\n双击：一起玩\n拖动：抱起来移动\n长按：喂白米饭、睡觉、暂停活动或收起\n\n通知里也能随时收起宠物。锁屏后暂停动画。", 14);
        text(root, "全部互动在本地运行，不需要账号、联网或无障碍权限。", 12);
    }
    @Override protected void onResume() { super.onResume(); if(status!=null)status.setText(Settings.canDrawOverlays(this)?"悬浮窗权限已开启":"请先开启悬浮窗权限"); }
    private TextView text(LinearLayout parent,String value,int sp) {
        TextView t=new TextView(this);t.setText(value);t.setTextSize(sp);t.setTextColor(Color.rgb(35,62,99));t.setPadding(0,dp(9),0,dp(9));parent.addView(t);return t;
    }
    private void button(LinearLayout parent,String value,View.OnClickListener listener) {
        Button b=new Button(this);b.setText(value);b.setAllCaps(false);b.setOnClickListener(listener);parent.addView(b,new LinearLayout.LayoutParams(-1,dp(54)));
    }
}
