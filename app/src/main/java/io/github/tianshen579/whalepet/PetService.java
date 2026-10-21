package io.github.tianshen579.whalepet;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.os.*;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.*;
import android.webkit.*;
import android.widget.Toast;

public final class PetService extends Service {
    private static final String CHANNEL="whale_pet", STOP="io.github.tianshen579.whalepet.STOP";
    private WindowManager wm;
    private WindowManager.LayoutParams params;
    private PetWebView web;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private SharedPreferences prefs;
    private volatile boolean menuOpen=false;
    private volatile boolean chatOpen=false;   // 聊天时窗口要能获得焦点，输入法才会上来
    private int preChatX,preChatY;             // 开聊前的窗口位置，关掉后还原
    private boolean attached=false, registered=false, screenOn=true;
    private int normalWidth,normalHeight;
    private float positionX,positionY;
    private final Runnable permissionCheck = new Runnable() {
        public void run() { if (!Settings.canDrawOverlays(PetService.this)) { stopSelf(); return; } handler.postDelayed(this,2000); }
    };
    private final BroadcastReceiver screen = new BroadcastReceiver() {
        public void onReceive(Context c,Intent i) {
            screenOn=!Intent.ACTION_SCREEN_OFF.equals(i.getAction());
            if(web==null)return;
            if(screenOn){web.onResume();web.resumeTimers();}else{js("pet.save()");web.onPause();web.pauseTimers();}
        }
    };
    private int dp(float n){return Math.round(n*getResources().getDisplayMetrics().density);}
    @Override public void onCreate(){
        super.onCreate();wm=(WindowManager)getSystemService(WINDOW_SERVICE);prefs=getSharedPreferences("pet",0);
        NotificationManager nm=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        nm.createNotificationChannel(new NotificationChannel(CHANNEL,"小鲸鱼陪伴",NotificationManager.IMPORTANCE_LOW));
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent!=null&&STOP.equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}
        if(!Settings.canDrawOverlays(this)){stopSelf();return START_NOT_STICKY;}
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,PetService.class).setAction(STOP),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n=new Notification.Builder(this,CHANNEL).setSmallIcon(R.drawable.ic_whale).setContentTitle("小鲸鱼正在陪你")
            .setContentText("长按宠物打开菜单，或点“收起”。").setOngoing(true).setContentIntent(open)
            .addAction(new Notification.Action.Builder(null,"收起",stop).build()).build();
        try {
            if(Build.VERSION.SDK_INT>=34)startForeground(41,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);else startForeground(41,n);
            if(web==null)showPet();
        }catch(RuntimeException e){Toast.makeText(this,"悬浮窗未能启动，请检查权限后重试。",Toast.LENGTH_LONG).show();stopSelf();}
        return START_NOT_STICKY;
    }
    private void showPet(){
        int size=Math.max(140,Math.min(260,prefs.getInt("size",180)));
        normalWidth=dp(size);normalHeight=dp(size+44);
        params=new WindowManager.LayoutParams(normalWidth,normalHeight,WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL|WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,PixelFormat.TRANSLUCENT);
        params.gravity=Gravity.TOP|Gravity.LEFT;
        params.x=prefs.getInt("x",dp(30));params.y=prefs.getInt("y",dp(230));positionX=params.x;positionY=params.y;
        web=new PetWebView();web.setBackgroundColor(Color.TRANSPARENT);web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(false);s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);s.setAllowFileAccessFromFileURLs(false);s.setAllowUniversalAccessFromFileURLs(false);s.setBlockNetworkLoads(true);
        web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){return true;}});
        web.addJavascriptInterface(new Bridge(),"AndroidPet");
        clamp();wm.addView(web,params);attached=true;web.loadUrl("file:///android_asset/pet.html?overlay=1");
        handler.postDelayed(sayPoller,4000);   // 开始轮询 DSH 的播报
        IntentFilter f=new IntentFilter();f.addAction(Intent.ACTION_SCREEN_OFF);f.addAction(Intent.ACTION_SCREEN_ON);
        if(Build.VERSION.SDK_INT>=33)registerReceiver(screen,f,Context.RECEIVER_NOT_EXPORTED);else registerReceiver(screen,f);
        registered=true;handler.post(permissionCheck);
    }
    private Rect safeArea(){
        if(Build.VERSION.SDK_INT>=30){
            WindowMetrics metrics=wm.getCurrentWindowMetrics();Rect r=new Rect(metrics.getBounds());
            Insets i=metrics.getWindowInsets().getInsetsIgnoringVisibility(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());
            r.left+=i.left;r.top+=i.top;r.right-=i.right;r.bottom-=i.bottom;return r;
        }
        DisplayMetrics d=new DisplayMetrics();wm.getDefaultDisplay().getRealMetrics(d);
        return new Rect(0,dp(26),d.widthPixels,d.heightPixels-dp(48));
    }
    private boolean clamp(){
        Rect r=safeArea();int oldX=params.x,oldY=params.y;
        params.x=Math.max(r.left,Math.min(params.x,Math.max(r.left,r.right-params.width)));
        params.y=Math.max(r.top,Math.min(params.y,Math.max(r.top,r.bottom-params.height)));
        return oldX!=params.x||oldY!=params.y;
    }
    private void update(){
        if(!attached||web==null)return;
        try { wm.updateViewLayout(web,params); }catch(RuntimeException e){stopSelf();}
    }
    private void js(String script){if(web!=null)web.evaluateJavascript("if(window.pet){"+script+";}",null);}
    private void rememberPosition(){prefs.edit().putInt("x",params.x).putInt("y",params.y).apply();}

    // ---------- 与沙箱里的 DSH 消息桥通信 ----------
    // 网络请求全部走这里，而不是放开 WebView：Bridge 原有的安全设置（禁文件访问、
    // setBlockNetworkLoads(true)）保持不动，网页只通过 JS 接口收发文本。
    private static final String BRIDGE_URL = "http://127.0.0.1:8901";
    private volatile boolean chatting = false;

    private static String slurp(java.io.InputStream in) throws java.io.IOException {
        java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        return new String(bo.toByteArray(), "UTF-8");
    }

    private static String httpGet(String url) throws java.io.IOException {
        java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
        c.setConnectTimeout(3000);
        c.setReadTimeout(8000);
        try { return slurp(c.getInputStream()); } finally { c.disconnect(); }
    }

    private static String httpPost(String url, String body) throws java.io.IOException {
        java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
        c.setRequestMethod("POST");
        c.setConnectTimeout(3000);
        c.setReadTimeout(240000);          // 一轮对话要等模型思考，时间给足
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        try {
            java.io.OutputStream o = c.getOutputStream();
            try { o.write(body.getBytes("UTF-8")); } finally { o.close(); }
            return slurp(c.getInputStream());
        } finally { c.disconnect(); }
    }

    /** 定时把 DSH 主动要说的话取回来，交给网页播报 */
    private final Runnable sayPoller = new Runnable() {
        @Override public void run() {
            if (web != null) new Thread(() -> {
                try {
                    org.json.JSONArray items = new org.json.JSONObject(httpGet(BRIDGE_URL + "/say")).optJSONArray("items");
                    if (items != null) for (int i = 0; i < items.length(); i++) {
                        final String t = items.optString(i, "");
                        if (!t.isEmpty()) handler.post(() -> js("pet.onPush(" + org.json.JSONObject.quote(t) + ")"));
                    }
                } catch (Exception ignored) { /* 桥没起来就安静跳过 */ }
            }).start();
            handler.postDelayed(this, 6000);
        }
    };
    public final class Bridge {
        @JavascriptInterface public String loadState(){return prefs.getString("state","{}");}
        @JavascriptInterface public void saveState(String json){if(json!=null&&json.length()<4096)prefs.edit().putString("state",json).apply();}
        @JavascriptInterface public void closePet(){handler.post(()->stopSelf());}
        @JavascriptInterface public void menuOpen(boolean open){handler.post(()->{
            menuOpen=open;if(params==null)return;
            params.width=open?Math.max(normalWidth,dp(240)):normalWidth;
            params.height=open?Math.max(normalHeight,dp(260)):normalHeight;
            clamp();positionX=params.x;positionY=params.y;update();
        });}
        @JavascriptInterface public void moveBy(float x,float y){
            if(!Float.isFinite(x)||!Float.isFinite(y))return;
            handler.post(()->{
                if(menuOpen||!screenOn||web==null||web.dragging||params==null)return;
                positionX+=Math.max(-5,Math.min(5,x))*getResources().getDisplayMetrics().density;
                positionY+=Math.max(-5,Math.min(5,y))*getResources().getDisplayMetrics().density;
                params.x=Math.round(positionX);params.y=Math.round(positionY);
                if(clamp()){positionX=params.x;positionY=params.y;js("pet.turn()");}update();
            });
        }
        /** 聊天期间轮询桥的进度，让网页能显示"她正在干嘛"，而不是干等转圈 */
        private void startProgressPolling(){
            new Thread(()->{
                while(chatting){
                    try{
                        final String p=httpGet(BRIDGE_URL+"/progress");
                        handler.post(()->js("pet.onProgress("+org.json.JSONObject.quote(p)+")"));
                    }catch(Exception ignored){ /* 桥忙或没起来，跳过这一轮 */ }
                    try{Thread.sleep(700);}catch(InterruptedException e){return;}
                }
            }).start();
        }
        /** 进入/退出聊天输入态。
         *  关键点：窗口是以 FLAG_NOT_FOCUSABLE 创建的，那种状态下永远拿不到输入焦点，
         *  输入法不会弹出。开聊时把这个标志去掉并请求焦点，收聊时再装回去。 */
        @JavascriptInterface public void chatMode(boolean on){
            handler.post(()->{
                chatOpen=on;
                if(params==null)return;
                if(on){
                    preChatX=params.x;preChatY=params.y;
                    params.flags&=~WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
                    params.softInputMode=WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
                                       |WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE;
                    // 把小窗抬到屏幕上半部，免得被键盘盖住
                    int limit=Math.round(getResources().getDisplayMetrics().heightPixels*0.45f);
                    if(params.y+params.height>limit)params.y=Math.max(0,limit-params.height);
                }else{
                    params.flags|=WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE;
                    params.softInputMode=WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN;
                    params.x=preChatX;params.y=preChatY;
                    android.view.inputmethod.InputMethodManager imm=
                        (android.view.inputmethod.InputMethodManager)getSystemService(INPUT_METHOD_SERVICE);
                    if(imm!=null&&web!=null)imm.hideSoftInputFromWindow(web.getWindowToken(),0);
                }
                clamp();positionX=params.x;positionY=params.y;update();
                if(on&&web!=null){
                    web.setFocusable(true);web.setFocusableInTouchMode(true);web.requestFocus();
                    // 窗口刚拿到焦点，再催一次输入框，确保输入法跟上
                    handler.postDelayed(()->js("var i=document.getElementById('chatInput');if(i){i.focus();i.click();}"),220);
                }
            });
        }
        /** 把用户对宠物说的话送去 DSH，回复到了再回调网页 */
        @JavascriptInterface public void chat(String text){
            if(text==null)return;
            final String q=text.trim();
            if(q.isEmpty()||chatting)return;
            chatting=true;
            startProgressPolling();
            new Thread(()->{
                String reply;
                try {
                    org.json.JSONObject body=new org.json.JSONObject();
                    body.put("text",q);
                    org.json.JSONObject res=new org.json.JSONObject(httpPost(BRIDGE_URL+"/chat",body.toString()));
                    reply=res.has("reply")?res.optString("reply"):res.optString("error","我这边没有回应…");
                } catch (Exception e) {
                    reply="连不上我那边（"+e.getMessage()+"）";
                }
                final String r=reply;
                handler.post(()->{js("pet.onReply("+org.json.JSONObject.quote(r)+")");chatting=false;});
            }).start();
        }
    }
    private final class PetWebView extends WebView {
        private float downX,downY;
        private int startX,startY;
        private boolean dragging=false;
        private final int slop;
        private final GestureDetector detector;
        PetWebView(){
            super(new ContextThemeWrapper(PetService.this,android.R.style.Theme_Material_Light_NoActionBar));
            setFocusable(true);setFocusableInTouchMode(true);   // 聊天输入需要能拿到焦点
            slop=ViewConfiguration.get(PetService.this).getScaledTouchSlop();
            detector=new GestureDetector(PetService.this,new GestureDetector.SimpleOnGestureListener(){
                @Override public boolean onDown(android.view.MotionEvent e){return true;}
                @Override public boolean onSingleTapConfirmed(android.view.MotionEvent e){if(!dragging)js("pet.act('pet')");return true;}
                @Override public boolean onDoubleTap(android.view.MotionEvent e){js("pet.act('play')");return true;}
                @Override public void onLongPress(android.view.MotionEvent e){if(!dragging)js("pet.showMenu(true)");}
            });
        }
        @Override public boolean onTouchEvent(android.view.MotionEvent event){
            if(menuOpen||chatOpen)return super.onTouchEvent(event);
            int action=event.getActionMasked();
            if(action==android.view.MotionEvent.ACTION_DOWN){downX=event.getRawX();downY=event.getRawY();startX=params.x;startY=params.y;dragging=false;}
            if(action==android.view.MotionEvent.ACTION_MOVE){
                float dx=event.getRawX()-downX,dy=event.getRawY()-downY;
                if(!dragging&&Math.hypot(dx,dy)>slop){
                    dragging=true;android.view.MotionEvent cancel=android.view.MotionEvent.obtain(event);cancel.setAction(android.view.MotionEvent.ACTION_CANCEL);detector.onTouchEvent(cancel);cancel.recycle();js("pet.setDragging(true)");
                }
                if(dragging){params.x=startX+Math.round(dx);params.y=startY+Math.round(dy);clamp();positionX=params.x;positionY=params.y;update();return true;}
            }
            if((action==android.view.MotionEvent.ACTION_UP||action==android.view.MotionEvent.ACTION_CANCEL)&&dragging){
                dragging=false;js("pet.setDragging(false)");rememberPosition();return true;
            }
            detector.onTouchEvent(event);return true;
        }
    }
    @Override public void onConfigurationChanged(Configuration c){super.onConfigurationChanged(c);if(params!=null){clamp();positionX=params.x;positionY=params.y;update();}}
    @Override public void onDestroy(){
        handler.removeCallbacksAndMessages(null);if(registered)unregisterReceiver(screen);
        if(params!=null)rememberPosition();
        if(web!=null){if(attached){try{wm.removeView(web);}catch(RuntimeException ignored){}}web.resumeTimers();web.removeJavascriptInterface("AndroidPet");web.destroy();web=null;}
        attached=false;stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent){return null;}
}
