<?php
/**
 * Plugin Name: Tollgate Pay-Per-Read
 * Description: Gates selected WordPress posts and checks Tollgate's hosted receipt status.
 * Version: 0.1.0
 * Author: Tollgate
 * License: GPL-2.0-or-later
 * Requires at least: 6.0
 * Requires PHP: 7.4
 */

if (!defined('ABSPATH')) {
    exit;
}

const TOLLGATE_OPTION_NAME = 'tollgate_options';
const TOLLGATE_GATED_META = '_tollgate_gated';
const TOLLGATE_PRICE_META = '_tollgate_price_atomic_usdc';
const TOLLGATE_READER_COOKIE = 'tollgate_reader';
const TOLLGATE_DEFAULT_PRICE_ATOMIC_USDC = 2500;

add_action('admin_menu', 'tollgate_register_settings_page');
add_action('admin_init', 'tollgate_register_settings');
add_action('add_meta_boxes', 'tollgate_add_gate_meta_box');
add_action('save_post', 'tollgate_save_gate_meta');
add_action('rest_api_init', 'tollgate_register_rest_routes');
add_action('template_redirect', 'tollgate_agent_payment_required', 9);
add_filter('the_content', 'tollgate_gate_content');

function tollgate_default_options(): array
{
    return array(
        'api_base' => 'https://tollgate.gudman.xyz',
        'site_key' => '',
        'creator_wallet' => '',
        'default_price_atomic_usdc' => TOLLGATE_DEFAULT_PRICE_ATOMIC_USDC,
    );
}

function tollgate_options(): array
{
    $saved = get_option(TOLLGATE_OPTION_NAME, array());
    return wp_parse_args(is_array($saved) ? $saved : array(), tollgate_default_options());
}

function tollgate_register_settings_page(): void
{
    add_options_page(
        'Tollgate',
        'Tollgate',
        'manage_options',
        'tollgate',
        'tollgate_render_settings_page'
    );
}

function tollgate_register_settings(): void
{
    register_setting('tollgate_settings', TOLLGATE_OPTION_NAME, array(
        'type' => 'array',
        'sanitize_callback' => 'tollgate_sanitize_options',
        'default' => tollgate_default_options(),
    ));

    add_settings_section(
        'tollgate_main',
        'Hosted settlement API',
        'tollgate_render_settings_intro',
        'tollgate'
    );

    add_settings_field('api_base', 'API base URL', 'tollgate_render_api_base_field', 'tollgate', 'tollgate_main');
    add_settings_field('site_key', 'Site API key', 'tollgate_render_site_key_field', 'tollgate', 'tollgate_main');
    add_settings_field('creator_wallet', 'Creator wallet', 'tollgate_render_wallet_field', 'tollgate', 'tollgate_main');
    add_settings_field('default_price_atomic_usdc', 'Default price', 'tollgate_render_price_field', 'tollgate', 'tollgate_main');
}

function tollgate_sanitize_options($input): array
{
    $input = is_array($input) ? $input : array();
    $current = tollgate_options();

    $api_base = isset($input['api_base']) ? esc_url_raw(trim((string) $input['api_base'])) : $current['api_base'];
    if (!preg_match('/^https?:\/\//', $api_base)) {
        $api_base = $current['api_base'];
    }

    $wallet = isset($input['creator_wallet']) ? sanitize_text_field((string) $input['creator_wallet']) : '';
    if ($wallet !== '' && !preg_match('/^0x[a-fA-F0-9]{40}$/', $wallet)) {
        add_settings_error(TOLLGATE_OPTION_NAME, 'wallet', 'Creator wallet must be a valid 0x address.');
        $wallet = $current['creator_wallet'];
    }

    $price = isset($input['default_price_atomic_usdc']) ? absint($input['default_price_atomic_usdc']) : TOLLGATE_DEFAULT_PRICE_ATOMIC_USDC;
    if ($price < 1) {
        $price = TOLLGATE_DEFAULT_PRICE_ATOMIC_USDC;
    }

    return array(
        'api_base' => untrailingslashit($api_base),
        'site_key' => isset($input['site_key']) ? sanitize_text_field((string) $input['site_key']) : '',
        'creator_wallet' => $wallet,
        'default_price_atomic_usdc' => $price,
    );
}

function tollgate_render_settings_intro(): void
{
    echo '<p>Ask the Tollgate operator to register this site, wallet, and price, then paste the returned site API key here. The plugin checks existing receipts but cannot initiate settlement without reader payment authorization.</p>';
}

function tollgate_render_api_base_field(): void
{
    $options = tollgate_options();
    printf(
        '<input type="url" class="regular-text" name="%1$s[api_base]" value="%2$s" />',
        esc_attr(TOLLGATE_OPTION_NAME),
        esc_attr($options['api_base'])
    );
}

function tollgate_render_site_key_field(): void
{
    $options = tollgate_options();
    printf(
        '<input type="password" class="regular-text" name="%1$s[site_key]" value="%2$s" autocomplete="off" />',
        esc_attr(TOLLGATE_OPTION_NAME),
        esc_attr($options['site_key'])
    );
    echo '<p class="description">Stored by WordPress. Tollgate stores only a hash of this key.</p>';
}

function tollgate_render_wallet_field(): void
{
    $options = tollgate_options();
    printf(
        '<input type="text" class="regular-text" name="%1$s[creator_wallet]" value="%2$s" placeholder="0x..." />',
        esc_attr(TOLLGATE_OPTION_NAME),
        esc_attr($options['creator_wallet'])
    );
}

function tollgate_render_price_field(): void
{
    $options = tollgate_options();
    printf(
        '<input type="number" min="1" step="1" name="%1$s[default_price_atomic_usdc]" value="%2$d" /> <span class="description">atomic USDC. 2500 = $0.0025.</span>',
        esc_attr(TOLLGATE_OPTION_NAME),
        absint($options['default_price_atomic_usdc'])
    );
}

function tollgate_render_settings_page(): void
{
    if (!current_user_can('manage_options')) {
        return;
    }
    $options = tollgate_options();
    ?>
    <div class="wrap">
        <h1>Tollgate Pay-Per-Read</h1>
        <p>Registration requires an operator-issued capability and binds the site URL, creator wallet, and price on Tollgate. Paste the returned site API key below.</p>
        <form method="post" action="options.php">
            <?php
            settings_fields('tollgate_settings');
            do_settings_sections('tollgate');
            submit_button();
            ?>
        </form>
    </div>
    <?php
}

function tollgate_add_gate_meta_box(): void
{
    add_meta_box(
        'tollgate_gate',
        'Tollgate Pay-Per-Read',
        'tollgate_render_gate_meta_box',
        'post',
        'side',
        'default'
    );
}

function tollgate_render_gate_meta_box($post): void
{
    wp_nonce_field('tollgate_save_gate_meta', 'tollgate_gate_nonce');
    $enabled = get_post_meta($post->ID, TOLLGATE_GATED_META, true) === '1';
    $price = tollgate_post_price($post->ID);
    ?>
    <p>
        <label>
            <input type="checkbox" name="tollgate_gated" value="1" <?php checked($enabled); ?> />
            Gate this post with Tollgate
        </label>
    </p>
    <p>
        <label for="tollgate_price_atomic_usdc">Price, atomic USDC</label>
        <input type="number" min="1" step="1" id="tollgate_price_atomic_usdc" name="tollgate_price_atomic_usdc" value="<?php echo esc_attr((string) $price); ?>" class="widefat" />
    </p>
    <p class="description">2500 = $0.0025. This display price must match the immutable price approved during Tollgate registration.</p>
    <?php
}

function tollgate_save_gate_meta(int $post_id): void
{
    if (!isset($_POST['tollgate_gate_nonce']) || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['tollgate_gate_nonce'])), 'tollgate_save_gate_meta')) {
        return;
    }
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
        return;
    }
    if (!current_user_can('edit_post', $post_id)) {
        return;
    }

    update_post_meta($post_id, TOLLGATE_GATED_META, isset($_POST['tollgate_gated']) ? '1' : '0');

    $price = isset($_POST['tollgate_price_atomic_usdc']) ? absint($_POST['tollgate_price_atomic_usdc']) : 0;
    if ($price > 0) {
        update_post_meta($post_id, TOLLGATE_PRICE_META, (string) $price);
    } else {
        delete_post_meta($post_id, TOLLGATE_PRICE_META);
    }
}

function tollgate_register_rest_routes(): void
{
    register_rest_route('tollgate/v1', '/pay/(?P<post_id>\d+)', array(
        'methods' => 'POST',
        'callback' => 'tollgate_rest_payment_permission',
        'permission_callback' => 'tollgate_rest_payment_permission',
        'args' => array(
            'post_id' => array(
                'validate_callback' => 'tollgate_validate_post_id',
            ),
        ),
    ));
}

function tollgate_validate_post_id($value): bool
{
    return absint($value) > 0;
}

function tollgate_rest_payment_permission($request)
{
    $post_id = absint($request['post_id']);
    if (!$post_id || !tollgate_is_gated_post($post_id)) {
        return new WP_Error('tollgate_not_gated', 'This post is not gated by Tollgate.', array('status' => 404));
    }

    return new WP_Error(
        'tollgate_reader_payment_required',
        'Reader payment authorization is required before Tollgate can settle this post.',
        array('status' => 402)
    );
}

function tollgate_agent_payment_required(): void
{
    if (!is_singular('post')) {
        return;
    }
    $post_id = get_queried_object_id();
    if (!$post_id || !tollgate_is_gated_post($post_id) || !tollgate_is_agent_user_agent(tollgate_user_agent())) {
        return;
    }

    $status = tollgate_remote_status($post_id, false);
    if (is_array($status) && !empty($status['paid'])) {
        return;
    }

    status_header(402);
    nocache_headers();
    header('Content-Type: application/json; charset=' . get_option('blog_charset'));
    echo wp_json_encode(array(
        'error' => 'payment_required',
        'message' => 'This WordPress post is gated by Tollgate. Reader payment authorization is required before settlement.',
        'paymentRequirements' => array(
            'network' => 'arc-testnet',
            'asset' => 'USDC',
            'amountAtomicUsdc' => tollgate_post_price($post_id),
            'resource' => get_permalink($post_id),
            'payEndpoint' => rest_url('tollgate/v1/pay/' . $post_id),
            'proofEndpoint' => tollgate_api_url('/api/wordpress/proof'),
        ),
    ));
    exit;
}

function tollgate_gate_content(string $content): string
{
    if (is_admin() || !in_the_loop() || !is_main_query()) {
        return $content;
    }

    $post_id = get_the_ID();
    if (!$post_id || get_post_type($post_id) !== 'post' || !tollgate_is_gated_post($post_id)) {
        return $content;
    }

    $status = tollgate_remote_status($post_id, is_singular('post'));
    if (is_array($status) && !empty($status['paid'])) {
        return $content;
    }

    return tollgate_render_paywall($post_id);
}

function tollgate_render_paywall(int $post_id): string
{
    $price = tollgate_post_price($post_id);

    ob_start();
    ?>
    <section class="tollgate-paywall" data-tollgate-post="<?php echo esc_attr((string) $post_id); ?>">
        <h2>This post is gated by Tollgate</h2>
        <p>Reader payment authorization is required before Tollgate can create a settlement receipt.</p>
        <p><strong><?php echo esc_html(tollgate_format_atomic_usdc($price)); ?></strong></p>
        <p>Existing verified receipts still unlock this post automatically.</p>
    </section>
    <?php
    return (string) ob_get_clean();
}

function tollgate_is_gated_post(int $post_id): bool
{
    return get_post_meta($post_id, TOLLGATE_GATED_META, true) === '1';
}

function tollgate_post_price(int $post_id): int
{
    $meta_price = absint(get_post_meta($post_id, TOLLGATE_PRICE_META, true));
    if ($meta_price > 0) {
        return $meta_price;
    }
    $options = tollgate_options();
    return max(1, absint($options['default_price_atomic_usdc']));
}

function tollgate_remote_status(int $post_id, bool $create_reader): array
{
    $result = tollgate_api_post('/api/wordpress/posts/' . rawurlencode((string) $post_id) . '/status', tollgate_post_payload($post_id, $create_reader));
    return is_wp_error($result) ? array('paid' => false, 'error' => $result->get_error_message()) : $result;
}

function tollgate_post_payload(int $post_id, bool $create_reader): array
{
    return array(
        'priceAtomicUsdc' => tollgate_post_price($post_id),
        'requesterFingerprint' => tollgate_reader_fingerprint($create_reader),
        'title' => get_the_title($post_id),
        'postUrl' => get_permalink($post_id),
    );
}

function tollgate_api_post(string $path, array $body)
{
    $options = tollgate_options();
    if (empty($options['site_key'])) {
        return new WP_Error('tollgate_not_configured', 'Tollgate site API key is not configured.', array('status' => 503));
    }

    $response = wp_remote_post(tollgate_api_url($path), array(
        'timeout' => 20,
        'headers' => array(
            'Accept' => 'application/json',
            'Content-Type' => 'application/json',
            'X-Tollgate-Site-Key' => $options['site_key'],
        ),
        'body' => wp_json_encode($body),
    ));

    if (is_wp_error($response)) {
        return $response;
    }

    $code = wp_remote_retrieve_response_code($response);
    $raw_body = wp_remote_retrieve_body($response);
    $decoded = json_decode($raw_body, true);
    $decoded = is_array($decoded) ? $decoded : array();

    if ($code < 200 || $code >= 300) {
        $message = isset($decoded['error']) ? sanitize_text_field((string) $decoded['error']) : 'Tollgate API returned HTTP ' . $code . '.';
        return new WP_Error('tollgate_api_error', $message, array('status' => $code, 'body' => $decoded));
    }

    return $decoded;
}

function tollgate_api_url(string $path): string
{
    $options = tollgate_options();
    return untrailingslashit($options['api_base']) . '/' . ltrim($path, '/');
}

function tollgate_reader_fingerprint(bool $create): string
{
    if (isset($_COOKIE[TOLLGATE_READER_COOKIE])) {
        return sanitize_text_field(wp_unslash($_COOKIE[TOLLGATE_READER_COOKIE]));
    }

    if ($create) {
        $token = wp_generate_uuid4();
        if (!headers_sent()) {
            setcookie(TOLLGATE_READER_COOKIE, $token, time() + YEAR_IN_SECONDS, COOKIEPATH, COOKIE_DOMAIN, is_ssl(), true);
            $_COOKIE[TOLLGATE_READER_COOKIE] = $token;
        }
        return $token;
    }

    return hash('sha256', tollgate_user_agent() . '|' . tollgate_remote_addr());
}

function tollgate_user_agent(): string
{
    return isset($_SERVER['HTTP_USER_AGENT']) ? sanitize_text_field(wp_unslash($_SERVER['HTTP_USER_AGENT'])) : '';
}

function tollgate_remote_addr(): string
{
    return isset($_SERVER['REMOTE_ADDR']) ? sanitize_text_field(wp_unslash($_SERVER['REMOTE_ADDR'])) : 'unknown';
}

function tollgate_is_agent_user_agent(string $user_agent): bool
{
    if ($user_agent === '') {
        return false;
    }
    $agents = array(
        'GPTBot',
        'ChatGPT-User',
        'ClaudeBot',
        'Claude-User',
        'Google-Extended',
        'PerplexityBot',
        'CCBot',
        'Bytespider',
        'Applebot-Extended',
        'Meta-ExternalAgent',
    );
    foreach ($agents as $agent) {
        if (stripos($user_agent, $agent) !== false) {
            return true;
        }
    }
    return false;
}

function tollgate_format_atomic_usdc(int $amount): string
{
    return '$' . number_format($amount / 1000000, 4) . ' USDC';
}
