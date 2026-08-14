"""초보자를 위한 구구단과 별찍기 연습 프로그램."""


def print_multiplication_table(number: int) -> None:
    """입력한 숫자의 구구단을 출력한다."""
    print(f"\n{number}단")
    for multiplier in range(1, 10):
        print(f"{number} × {multiplier} = {number * multiplier}")


def print_star_triangle(height: int) -> None:
    """입력한 높이만큼 별 삼각형을 출력한다."""
    print()
    for row in range(1, height + 1):
        print("*" * row)


def read_positive_number(prompt: str) -> int:
    """사용자가 양의 정수를 입력할 때까지 다시 묻는다."""
    while True:
        try:
            number = int(input(prompt))
            if number > 0:
                return number
            print("1 이상의 숫자를 입력해 주세요.")
        except ValueError:
            print("숫자만 입력해 주세요.")


def main() -> None:
    print("=== 초보자 코딩 연습 ===")
    print("1. 구구단")
    print("2. 별찍기")

    choice = input("메뉴를 선택하세요 (1 또는 2): ").strip()

    if choice == "1":
        number = read_positive_number("몇 단을 출력할까요? ")
        print_multiplication_table(number)
    elif choice == "2":
        height = read_positive_number("삼각형 높이는 얼마로 할까요? ")
        print_star_triangle(height)
    else:
        print("1 또는 2를 선택해 주세요.")


if __name__ == "__main__":
    main()
