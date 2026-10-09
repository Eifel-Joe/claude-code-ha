#!/bin/bash

# Claude Authentication Helper
# Provides alternative authentication methods when clipboard paste doesn't work

# Where option 2 reads the code from. Overridable for tests only
# (tests/test-auth-helper.sh).
AUTH_CODE_FILE="${CLAUDE_AUTH_CODE_FILE:-/config/auth-code.txt}"

show_auth_menu() {
    clear
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║               🔐 Claude Authentication Helper                 ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Having trouble pasting the authentication code?"
    echo ""
    echo "Options:"
    echo "  1) 📋 Manual input (type or paste the code)"
    echo "  2) 📁 Read code from file (${AUTH_CODE_FILE})"
    echo "  3) 🔄 Retry standard authentication"
    echo "  4) ❌ Exit"
    echo ""
}

manual_auth_input() {
    echo ""
    echo "Please enter your authentication code:"
    echo "(You can try pasting with Ctrl+Shift+V, right-click, or type manually)"
    echo ""
    echo -n "Code: "
    read -r auth_code

    if [ -z "$auth_code" ]; then
        echo "❌ No code provided"
        return 1
    fi

    echo "✅ Starting Claude authentication..."
    sleep 1

    # Try to pipe the code to Claude
    echo "$auth_code" | claude
}

read_auth_from_file() {
    local auth_file="$AUTH_CODE_FILE"

    echo ""
    echo "Looking for authentication code in: $auth_file"

    if [ -f "$auth_file" ]; then
        auth_code=$(cat "$auth_file")
        # Remove the file before Claude runs: it holds a login secret in /config,
        # which is in every Home Assistant backup (owine, 96ccd0d4).
        rm -f "$auth_file"
        echo "🧹 Removed $auth_file"

        if [ -z "$auth_code" ]; then
            echo "❌ File was empty"
            return 1
        fi

        echo "✅ Code found. Starting Claude authentication..."
        sleep 1

        # Try to pipe the code to Claude
        echo "$auth_code" | claude
    else
        echo "❌ File not found: $auth_file"
        echo ""
        echo "To use this method:"
        echo "1. Create the file in Home Assistant's config directory"
        echo "2. Paste your authentication code in the file"
        echo "3. Save the file and try again"
        return 1
    fi
}

retry_standard_auth() {
    echo ""
    echo "🔄 Starting standard Claude authentication..."
    echo ""
    echo "Tips for pasting in the web terminal:"
    echo "• Try Ctrl+Shift+V"
    echo "• Try right-clicking"
    echo "• Try the browser's Edit menu > Paste"
    echo "• On mobile, long-press may show paste option"
    echo ""
    sleep 2
    exec claude
}

main() {
    while true; do
        show_auth_menu

        echo -n "Enter your choice [1-4]: "
        read -r choice || exit 1  # end of input: nothing left to choose

        case "$choice" in
            1)
                manual_auth_input
                if [ $? -eq 0 ]; then
                    exit 0
                fi
                echo ""
                echo "Press Enter to continue..."
                read -r
                ;;
            2)
                read_auth_from_file
                if [ $? -eq 0 ]; then
                    exit 0
                fi
                echo ""
                echo "Press Enter to continue..."
                read -r
                ;;
            3)
                retry_standard_auth
                ;;
            4)
                echo "👋 Exiting..."
                exit 0
                ;;
            *)
                echo "❌ Invalid choice"
                sleep 1
                ;;
        esac
    done
}

# Run main function
main "$@"