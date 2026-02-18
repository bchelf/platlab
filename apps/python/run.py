from core import Rect, default_params, init_state, step, RIGHT, JUMP

def main():
    p = default_params()
    p.world_w = 960.0

    # Simple ground
    world = [Rect(0, 480, 960, 60)]

    # Spawn
    s = init_state(80, 480 - 44, 28, 44)

    for f in range(180):
        inp = 0
        if f < 120:
            inp |= RIGHT
        if f == 10:
            inp |= JUMP

        ev = step(p, world, s, inp)

        if ev.jumped:
            print("jumped @", f)
        if ev.landed:
            print("landed @", f)

        if f % 30 == 0:
            print(f, "x,y=", s.x, s.y, "vx,vy=", s.vx, s.vy, "grounded=", s.grounded)

if __name__ == "__main__":
    main()
