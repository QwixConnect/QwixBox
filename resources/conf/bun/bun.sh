# Managed by the QwixBox installer.
export BUN_INSTALL="@BUN_INSTALL@"
case ":$PATH:" in
  *":$BUN_INSTALL/bin:"*) ;;
  *) export PATH="$BUN_INSTALL/bin:$PATH" ;;
esac
