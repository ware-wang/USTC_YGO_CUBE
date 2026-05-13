#include <cstdio>
#include <cstring>
#include "ocgapi.h"

extern "C" {
#include "lua.h"
#include "lualib.h"
#include "lauxlib.h"
}
#include "card_data.h"

static byte* script_reader_cb(const char* name, int* len) {
    std::string path = "/home/wjl/.openclaw/workspace/ygopro/script/" + std::string(name);
    FILE* f = fopen(path.c_str(), "rb");
    if (!f) return nullptr;
    fseek(f, 0, SEEK_END);
    *len = (int)ftell(f);
    fseek(f, 0, SEEK_SET);
    byte* buf = new byte[*len];
    fread(buf, 1, *len, f);
    fclose(f);
    return buf;
}

static uint32_t card_reader_cb(uint32_t code, card_data* d) {
    static FILE* db = fopen("/home/wjl/.openclaw/workspace/cube-draft/server/data/cards.cdb", "rb");
    if (db && d) {
        memset(d, 0, sizeof(card_data));
        fseek(db, 0, SEEK_SET);
        card_data e;
        while (fread(&e, sizeof(card_data), 1, db) == 1) {
            if (e.code == code) { *d = e; return code; }
        }
        d->code = code; d->level = 4;
        d->attribute = 0x01; d->race = 0x01;
        d->attack = 1800; d->defense = 1200;
        d->type = TYPE_NORMAL | TYPE_MONSTER;
        return code;
    }
    return 0;
}

int main() {
    set_script_reader(script_reader_cb);
    set_card_reader(card_reader_cb);
    setvbuf(stdout, nullptr, _IONBF, 0);
    
    intptr_t pd = create_duel(42);
    int cards[] = {4148264, 5464695, 7459013, 11091375, 46986414};
    for (int i=0;i<5;i++) {
        new_card(pd, cards[i], 0, 0, LOCATION_DECK, 0, 0);
        new_card(pd, cards[i], 1, 1, LOCATION_DECK, 0, 0);
    }
    set_player_info(pd, 0, 8000, 5, 1);
    set_player_info(pd, 1, 8000, 5, 1);
    start_duel(pd, DUEL_PSEUDO_SHUFFLE);
    
    byte mb[0x1000];
    // Process until idle command
    while (1) {
        uint32_t r = process(pd);
        int len = get_message(pd, mb);
        fprintf(stderr, "r=0x%x len=%d\n", (unsigned)r, len);
        if (len >= 4) {
            if (len < 4) continue;
            int mt = mb[0];
            if (mt >= 10 && mt <= 30) { // SELECT range
                fprintf(stderr, "SELECT t=%d\n", mt);
                fprintf(stdout, "BUF:");
                for (int i=0;i<len;i++) fprintf(stdout, "%02x", mb[i]);
                fprintf(stdout, "\n");
                break;
            }
            set_responsei(pd, 0);
        } else {
            if (r & PROCESSOR_FLAG) set_responsei(pd, 0);
        }
    }
    
    end_duel(pd);
    return 0;
}
