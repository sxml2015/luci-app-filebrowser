# luci-app-filebrowser - ported for coolsnowwolf/lede (OpenWrt 25.12)
#
# Original Lua application: https://github.com/DarkDean89/luci-app-filebrowser
# This port rewrites it as a JavaScript view + ucode rpcd backend, following
# the layout of applications/luci-app-example in coolsnowwolf/luci
# branch openwrt-25.12.
#
# Placement:
#  - If this directory lives in the LuCI feed (feeds/luci/applications/),
#    keep:  include ../../luci.mk
#  - If this directory lives directly in the LEDE tree (package/),
#    use:   include $(TOPDIR)/feeds/luci/luci.mk      (default below)

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI file browser app (25.12 port of luci-app-filebrowser)
LUCI_DEPENDS:=+luci-base +rpcd +ucode-mod-fs
LUCI_PKGARCH:=all

PKG_LICENSE:=GPL-2.0
PKG_MAINTAINER:=DarkDean89 (original), 25.12 port contributors

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
